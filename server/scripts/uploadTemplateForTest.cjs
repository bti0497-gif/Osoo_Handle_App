const fs = require('fs');
const path = require('path');
const http = require('http');

const port = Number(process.argv[2] || 8901);
const filePath = process.argv[3];

if (!filePath) {
  console.error('Usage: node server/scripts/uploadTemplateForTest.cjs <port> <excelTemplatePath>');
  process.exit(1);
}

const boundary = `----osoo${Date.now()}`;
const resolvedPath = path.resolve(filePath);
const fileName = path.basename(resolvedPath);
const fileBuffer = fs.readFileSync(resolvedPath);

const preamble = Buffer.from(
  `--${boundary}\r\n`
  + `Content-Disposition: form-data; name="report_templates"; filename="${fileName}"\r\n`
  + `Content-Type: application/octet-stream\r\n\r\n`
);

const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);
const body = Buffer.concat([preamble, fileBuffer, epilogue]);

const req = http.request(
  {
    method: 'POST',
    host: '127.0.0.1',
    port,
    path: '/api/settings/upload',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      console.log('status', res.statusCode);
      console.log(data);
    });
  }
);

req.on('error', (err) => {
  console.error(err);
  process.exitCode = 1;
});

req.write(body);
req.end();
