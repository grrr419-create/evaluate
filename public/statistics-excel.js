import { ASSESSMENT_CRITERIA, assessmentGrade, assessmentSummary } from './assessment-rules.js';

/* Minimal XLSX writer: fixed XML schema, inline strings, numeric counts, no formulas/macros. */
('use strict');
export const StatisticsExcel = (() => {
  const encoder = new TextEncoder();
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const mainNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const escape = (value) =>
    String(value ?? '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(
        /[&<>"']/g,
        (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character],
      );

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const local = [],
      central = [];
    let offset = 0;
    for (const [filePath, text] of files) {
      const name = encoder.encode(filePath),
        data = encoder.encode(text),
        crc = crc32(data);
      const head = new Uint8Array(30 + name.length),
        view = new DataView(head.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x800, true);
      view.setUint16(12, 33, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, name.length, true);
      head.set(name, 30);
      const entry = new Uint8Array(46 + name.length),
        centralView = new DataView(entry.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x800, true);
      centralView.setUint16(14, 33, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint32(42, offset, true);
      entry.set(name, 46);
      local.push(head, data);
      central.push(entry);
      offset += head.length + data.length;
    }
    const centralSize = central.reduce((total, entry) => total + entry.length, 0),
      end = new Uint8Array(22),
      view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, files.length, true);
    view.setUint16(10, files.length, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, offset, true);
    const result = new Uint8Array(offset + centralSize + 22);
    let at = 0;
    for (const part of [...local, ...central, end]) {
      result.set(part, at);
      at += part.length;
    }
    return result;
  }

  const cell = (reference, value, style) =>
    typeof value === 'number'
      ? `<c r="${reference}" s="${style}"><v>${value}</v></c>`
      : `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
  const row = (number, cells, height) =>
    `<row r="${number}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells.join('')}</row>`;
  const percent = (count, total) => (total ? Math.round((count / total) * 1000) / 10 : 0);
  const percentText = (count, total) => String(percent(count, total)).replace(/\.0$/, '') + '%';
  const questionText = (value) => String(value ?? '').replace(/^\s*\d+[.)]\s*/, '');

  function worksheet({ rows, dimension, widths, merges, landscape = false }) {
    return (
      declaration +
      `<worksheet xmlns="${mainNamespace}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0" showGridLines="1"/></sheetViews><cols>` +
      widths
        .map(
          (width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
        )
        .join('') +
      `</cols><sheetData>${rows.join('')}</sheetData>` +
      (merges.length
        ? `<mergeCells count="${merges.length}">${merges.map((range) => `<mergeCell ref="${range}"/>`).join('')}</mergeCells>`
        : '') +
      `<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="${landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/></worksheet>`
    );
  }

  function validate(data) {
    if (
      !Number.isInteger(data?.completed) ||
      data.completed < 1 ||
      !Array.isArray(data.statistics) ||
      !data.statistics.length
    )
      throw new Error('제출된 평가가 없습니다.');
    if (
      !Array.isArray(data.responses) ||
      !Number.isInteger(data.response_count) ||
      data.response_count !== data.responses.length ||
      !Number.isInteger(data.unavailable_response_count) ||
      data.unavailable_response_count < 0 ||
      data.response_count + data.unavailable_response_count !== data.completed
    )
      throw new Error('개별 응답 수를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.');
    if (data.responses.length !== data.completed)
      throw new Error('현재 회차의 모든 개별 응답을 확인한 후 다시 시도해 주세요.');

    const questionIds = new Set(data.statistics.map((question) => question.id));
    if (questionIds.size !== data.statistics.length) throw new Error('문항 정보 검증에 실패했습니다.');
    const responseCounts = data.statistics.map((question) => Array(question.options.length).fill(0));
    for (const entry of data.responses) {
      const answers = entry?.answers;
      if (
        !answers ||
        typeof answers !== 'object' ||
        Array.isArray(answers) ||
        Object.keys(answers).some((key) => !questionIds.has(key))
      )
        throw new Error('개별 답변 검증에 실패했습니다.');
      data.statistics.forEach((question, questionIndex) => {
        const choice = answers[question.id];
        if (!Number.isInteger(choice) || choice < 0 || choice >= question.options.length)
          throw new Error('개별 답변 검증에 실패했습니다.');
        responseCounts[questionIndex][choice]++;
      });
    }
    data.statistics.forEach((question, questionIndex) => {
      const answered = Number.isInteger(question.answered)
        ? question.answered
        : question.counts.reduce((total, count) => total + count, 0);
      if (
        !Array.isArray(question.options) ||
        question.options.indexOf('예') < 0 ||
        question.options.indexOf('아니오') < 0 ||
        question.options.length !== question.counts.length ||
        question.counts.some((count) => !Number.isInteger(count) || count < 0) ||
        answered !== data.completed ||
        question.counts.reduce((total, count) => total + count, 0) !== answered ||
        responseCounts[questionIndex].some((count, choice) => count !== question.counts[choice])
      )
        throw new Error('응답 수 검증에 실패했습니다.');
    });
  }

  function summarySheet(data, summary) {
    const rows = [
      row(1, [cell('A1', '현장 종합평가 및 문항별 통계', 1), cell('B1', '', 1), cell('C1', '', 1)], 36),
      row(2, [cell('A2', '', 0), cell('B2', '', 0), cell('C2', '', 0)]),
      row(3, [cell('A3', '등   급', 3), cell('B3', '인   원', 4), cell('C3', '구성비', 5)], 33.95),
    ];
    ASSESSMENT_CRITERIA.forEach((grade, index) => {
      const count = summary.distribution[grade.key],
        number = index + 4,
        label = grade.label === '보통' ? '보   통' : grade.label === '미흡' ? '미   흡' : grade.label;
      rows.push(
        row(
          number,
          [
            cell(`A${number}`, label, 6),
            cell(`B${number}`, count, 7),
            cell(`C${number}`, count / data.completed, 8),
          ],
          33.95,
        ),
      );
    });
    rows.push(
      row(7, [cell('A7', '참여인원', 6), cell('B7', data.completed, 7), cell('C7', 1, 8)], 33.95),
      row(8, [cell('A8', '', 0), cell('B8', '', 0), cell('C8', '', 0)]),
      row(9, [cell('A9', '문   항', 3), cell('B9', '예', 4), cell('C9', '아니오', 5)], 33.95),
    );
    data.statistics.forEach((question, index) => {
      const number = index + 10,
        yes = question.counts[question.options.indexOf('예')],
        no = question.counts[question.options.indexOf('아니오')];
      rows.push(
        row(
          number,
          [
            cell(`A${number}`, questionText(question.text), 9),
            cell(`B${number}`, `${yes}명 (${percentText(yes, data.completed)})`, 10),
            cell(`C${number}`, `${no}명 (${percentText(no, data.completed)})`, 11),
          ],
          33.95,
        ),
      );
    });
    return worksheet({
      rows,
      dimension: `A1:C${data.statistics.length + 9}`,
      widths: [75, 20.625, 20.625],
      merges: ['A1:C1'],
      landscape: true,
    });
  }

  function responseSheet(data, response, index) {
    const score = data.statistics.reduce(
        (total, question) =>
          total + (response.answers[question.id] === question.options.indexOf('예') ? 1 : 0),
        0,
      ),
      grade = assessmentGrade(score),
      responseNumber = String(index + 1).padStart(3, '0'),
      questionEnd = data.statistics.length + 3,
      spacerRow = questionEnd + 1,
      stateHeadingRow = spacerRow + 1,
      stateRow = spacerRow + 2,
      descriptionHeadingRow = spacerRow + 3,
      descriptionRow = spacerRow + 4;
    const rows = [
      row(
        1,
        [
          cell('A1', `개별 응답 ${responseNumber} / ${grade.label} : ${grade.titleCriterion}`, 2),
          cell('B1', '', 2),
        ],
        50.1,
      ),
      row(2, [cell('A2', '', 0), cell('B2', '', 0)]),
      row(3, [cell('A3', '', 3), cell('B3', '선택 답변', 5)], 39.95),
    ];
    data.statistics.forEach((question, questionIndex) => {
      const number = questionIndex + 4,
        answer = question.options[response.answers[question.id]];
      rows.push(
        row(
          number,
          [
            cell(`A${number}`, questionText(question.text), 9),
            cell(`B${number}`, answer, answer === '아니오' ? 13 : 12),
          ],
          39.95,
        ),
      );
    });
    rows.push(
      row(spacerRow, [cell(`A${spacerRow}`, '', 0), cell(`B${spacerRow}`, '', 0)]),
      row(
        stateHeadingRow,
        [cell(`A${stateHeadingRow}`, '○ 현재 상태', 14), cell(`B${stateHeadingRow}`, '', 15)],
        39.95,
      ),
      row(
        stateRow,
        [cell(`A${stateRow}`, grade.state.replace(/\.$/, ''), 16), cell(`B${stateRow}`, '', 17)],
        39.95,
      ),
      row(
        descriptionHeadingRow,
        [cell(`A${descriptionHeadingRow}`, '○ 평가 내용', 14), cell(`B${descriptionHeadingRow}`, '', 15)],
        39.95,
      ),
      row(
        descriptionRow,
        [
          cell(`A${descriptionRow}`, grade.description.replace(/\.$/, ''), 18),
          cell(`B${descriptionRow}`, '', 19),
        ],
        39.95,
      ),
    );
    return {
      name: `개별 응답 ${responseNumber}(${grade.sheetLabel})`,
      xml: worksheet({
        rows,
        dimension: `A1:B${descriptionRow}`,
        widths: [70, 42],
        merges: [
          'A1:B1',
          `A${stateHeadingRow}:B${stateHeadingRow}`,
          `A${stateRow}:B${stateRow}`,
          `A${descriptionHeadingRow}:B${descriptionHeadingRow}`,
          `A${descriptionRow}:B${descriptionRow}`,
        ],
      }),
    };
  }

  const styles =
    declaration +
    `<styleSheet xmlns="${mainNamespace}"><numFmts count="2"><numFmt numFmtId="164" formatCode="0&quot;명&quot;"/><numFmt numFmtId="165" formatCode="0%"/></numFmts>` +
    '<fonts count="6"><font><sz val="10"/><name val="Malgun Gothic"/><color rgb="FF12304A"/></font><font><b/><sz val="16"/><name val="Malgun Gothic"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="15"/><name val="Malgun Gothic"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="10"/><name val="Malgun Gothic"/><color rgb="FF12304A"/></font><font><sz val="10"/><name val="Malgun Gothic"/><color rgb="FF000000"/></font><font><sz val="10"/><name val="Malgun Gothic"/><color rgb="FFB64747"/></font></fonts>' +
    '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF12304A"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1F7"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFCE8E8"/></patternFill></fill></fills>' +
    '<borders count="6"><border/><border><left style="thin"/><right style="thin"/><top style="hair"/><bottom style="hair"/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="double"/></border><border><left style="thin"/><right style="thin"/><bottom style="thin"/></border><border><left style="thin"/><right style="thin"/><bottom style="double"/></border><border><left style="thin"/><right style="thin"/><bottom style="hair"/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="20">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="4" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="3" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="3" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="5" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="5" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  function create(data) {
    validate(data);
    const summary = assessmentSummary(data);
    if (!summary) throw new Error('평가 결과를 판정하지 못했습니다. 새로고침 후 다시 시도해 주세요.');
    const sheets = [
      { name: '문항별 통계', xml: summarySheet(data, summary) },
      ...data.responses.map((response, index) => responseSheet(data, response, index)),
    ];
    const files = [
      [
        '[Content_Types].xml',
        declaration +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          sheets
            .map(
              (_, index) =>
                `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            )
            .join('') +
          '</Types>',
      ],
      [
        '_rels/.rels',
        declaration +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationshipNamespace}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ],
      [
        'xl/workbook.xml',
        declaration +
          `<workbook xmlns="${mainNamespace}" xmlns:r="${relationshipNamespace}"><sheets>` +
          sheets
            .map(
              (sheet, index) =>
                `<sheet name="${escape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
            )
            .join('') +
          '</sheets></workbook>',
      ],
      [
        'xl/_rels/workbook.xml.rels',
        declaration +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets
            .map(
              (_, index) =>
                `<Relationship Id="rId${index + 1}" Type="${relationshipNamespace}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
            )
            .join('') +
          `<Relationship Id="rId${sheets.length + 1}" Type="${relationshipNamespace}/styles" Target="styles.xml"/></Relationships>`,
      ],
      ['xl/styles.xml', styles],
      ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, sheet.xml]),
    ];
    return zip(files);
  }

  return { create };
})();
