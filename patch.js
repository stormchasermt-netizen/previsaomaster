const fs = require('fs');
let code = fs.readFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\ao-vivo\\page.tsx', 'utf8');

code = code.replace(
  "import Link from 'next/link';",
  "import Link from 'next/link';\nimport { useRouter } from 'next/navigation';"
);

code = code.replace(
  "const { user } = useAuth();\n  const { addToast } = useToast();",
  `const { user } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();

  useEffect(() => {
    if (user !== undefined && (!user || (user.type !== 'admin' && user.type !== 'superadmin'))) {
      router.push('/');
    }
  }, [user, router]);`
);

code = code.replace(
  "const RADAR_ICON_AVAILABLE = 'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/7e352d326e59aa65efc40ce2979d5a078a393dc4/radar-icon-svg-download-png-8993769.webp';",
  "const RADAR_ICON_AVAILABLE = 'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/78c82d9eb9f723ed65805e819046d598ace4a36e/radar-icon-svg-download-png-8993769.webp';"
);

code = code.replace(
  "const RADAR_ICON_UNAVAILABLE = 'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/7e352d326e59aa65efc40ce2979d5a078a393dc4/radar-icon-svg-download-png-8993769.webp';",
  "const RADAR_ICON_UNAVAILABLE = 'https://raw.githubusercontent.com/stormchasermt-netizen/previsaomaster/78c82d9eb9f723ed65805e819046d598ace4a36e/radar-icon-svg-download-png-8993769.webp';"
);

fs.writeFileSync('c:\\Users\\Usuário\\Downloads\\download (12)\\studio\\app\\ao-vivo\\page.tsx', code);
