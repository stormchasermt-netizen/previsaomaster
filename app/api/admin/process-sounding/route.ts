import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const { csvUrl } = await req.json();

    if (!csvUrl) {
      return NextResponse.json({ error: 'URL do CSV não fornecida' }, { status: 400 });
    }

    // 1. Baixar o CSV
    const response = await fetch(csvUrl);
    if (!response.ok) {
      return NextResponse.json({ error: 'Falha ao baixar o CSV do Storage' }, { status: 500 });
    }
    const csvContent = await response.text();

    // 2. Salvar em arquivo temporário
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `sounding_${Date.now()}.csv`);
    fs.writeFileSync(tempFilePath, csvContent);

    // 3. Executar o script Python
    const scriptPath = path.join(process.cwd(), 'lib', 'scripts', 'process_sounding.py');
    
    // Tenta usar 'python' ou 'python3'
    let pythonCmd = 'python';
    try {
      await execAsync('python --version');
    } catch {
      pythonCmd = 'python3';
    }

    const { stdout, stderr } = await execAsync(`${pythonCmd} "${scriptPath}" "${tempFilePath}"`);

    // 4. Limpeza
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    if (stderr && !stdout) {
      console.error('Python Error:', stderr);
      return NextResponse.json({ error: 'Erro no script Python', details: stderr }, { status: 500 });
    }

    try {
      const result = JSON.parse(stdout);
      return NextResponse.json(result);
    } catch (parseErr) {
      return NextResponse.json({ error: 'Falha ao processar saída do Python', output: stdout }, { status: 500 });
    }

  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
