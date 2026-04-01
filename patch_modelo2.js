const fs = require('fs');

let code = fs.readFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\modelo-numerico\\page.tsx', 'utf8');

code = code.replace(
  /const blob = await res\.blob\(\);\s*const imageUrl = URL\.createObjectURL\(blob\);\s*setSoundingImageUrl\(imageUrl\);/,
  "const data = await res.json();\n        if (data.image) {\n          setSoundingImageUrl(data.image);\n        } else {\n          throw new Error('A imagem não retornou em Base64 válida da API.');\n        }"
);

fs.writeFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\modelo-numerico\\page.tsx', code);
