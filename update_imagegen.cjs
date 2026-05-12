const fs = require('fs');

let content = fs.readFileSync('src/components/ImageGenerator.tsx', 'utf8');

const anchor = `<div className="flex-1 overflow-y-auto p-4 scrollbar-thin relative z-0">`;
const insert = `
        {sourceImage && !generatedImages.includes(sourceImage.data) && (
          <div className="mb-4 relative group inline-block ring-2 ring-indigo-500 rounded-lg p-1">
            <img 
              src={\`data:\${sourceImage.mimeType};base64,\${sourceImage.data}\`} 
              alt="Source" 
              className="w-48 h-auto rounded-md shadow-sm"
            />
            <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
              Source: {sourceImage.name}
            </div>
            <button 
              onClick={() => setSourceImage(null)}
              className="absolute top-2 right-2 bg-black/60 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove source image"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}
`;

if (!content.includes('alt="Source"')) {
  content = content.replace(anchor, anchor + insert);
  fs.writeFileSync('src/components/ImageGenerator.tsx', content);
  console.log('updated!');
}
