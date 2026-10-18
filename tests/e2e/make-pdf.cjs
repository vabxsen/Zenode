// Writes a minimal one-page PDF with a line of text, for tests. Usage: node make-pdf.cjs out.pdf "text"
const fs = require('fs')
const text = process.argv[3] || 'Hello'
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  null,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
]
const stream = `BT /F1 18 Tf 30 100 Td (${text}) Tj ET`
objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
let out = '%PDF-1.4\n'
const offsets = []
objs.forEach((o, i) => {
  offsets.push(out.length)
  out += `${i + 1} 0 obj\n${o}\nendobj\n`
})
const xref = out.length
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
fs.writeFileSync(process.argv[2], out, 'latin1')
