const fs = require('fs');
let content = fs.readFileSync('src/components/ImageGenerator.tsx', 'utf8');
content = content.replace('{generatedImages.length === 0 && !isLoading && (', '{generatedImages.length === 0 && !sourceImage && !isLoading && (');
fs.writeFileSync('src/components/ImageGenerator.tsx', content);
