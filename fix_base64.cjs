const fs = require('fs');

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(
    /const chunkSize = 32768; let binary = ""; for \(let i = 0; i < fileData\.length; i \+= chunkSize\) \{ binary \+= String\.fromCharCode\.apply\(null, fileData\.subarray\(i, i \+ chunkSize\) as unknown as number\[\]\); \} const base64 = btoa\(binary\);/,
    `let binary = "";
        const chunkSize = 32768;
        for (let i = 0; i < fileData.length; i += chunkSize) {
          const chunk = fileData.subarray(i, i + chunkSize);
          binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        const base64 = btoa(binary);`
  );
  fs.writeFileSync(filePath, content);
}

fixFile('src/components/ChatPanel.tsx');
fixFile('src/components/ImageGenerator.tsx');
