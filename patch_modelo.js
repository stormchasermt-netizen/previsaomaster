const fs = require('fs');

let code = fs.readFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\modelo-numerico\\page.tsx', 'utf8');

// Ajustar a forma como o Frontend lê a resposta (JSON vs Blob)
code = code.replace(
  "        // Recebemos a imagem renderizada como blob (via api interna -> Cloud Run)\n        const blob = await res.blob();\n        const imageUrl = URL.createObjectURL(blob);\n        setSoundingImageUrl(imageUrl);",
  "        // Recebemos a imagem Base64 dentro de um objeto JSON\n        const data = await res.json();\n        if (data.image) {\n          setSoundingImageUrl(data.image);\n        } else {\n          throw new Error('Imagem não retornada pela API.');\n        }"
);

fs.writeFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\modelo-numerico\\page.tsx', code);
