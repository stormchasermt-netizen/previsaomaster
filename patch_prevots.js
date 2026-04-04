const fs = require('fs');
let code = fs.readFileSync('app/ao-vivo-2/AoVivo2Content.tsx', 'utf8');

const imports = `import { useAuth } from '@/components/AuthProvider';
import { useToast } from '@/components/ui/use-toast';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { fetchPrevotsForecasts } from '@/lib/prevotsForecastStore';
import { PREVOTS_LEVEL_COLORS, type PrevotsForecast } from '@/lib/prevotsForecastData';
import { AlertTriangle, MapPin, Crosshair, Search, Image as ImageIcon, Link as LinkIcon, Camera, FileText, CheckCircle2, ShieldAlert, Info } from 'lucide-react';
`;

if (!code.includes('fetchPrevotsForecasts')) {
  code = code.replace(/import \{ motion, AnimatePresence \} from 'framer-motion';/, `${imports}import { motion, AnimatePresence } from 'framer-motion';`);
}

const states = `
  const { user } = useAuth();
  const { addToast } = useToast();

  const [prevotsOverlayVisible, setPrevotsOverlayVisible] = useState(false);
  const [prevotsForecasts, setPrevotsForecasts] = useState<PrevotsForecast[]>([]);
  const [prevotsForecastDate, setPrevotsForecastDate] = useState(() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  });
  const [showPrevotsDialog, setShowPrevotsDialog] = useState(false);
  const [selectedPrevotsLinks, setSelectedPrevotsLinks] = useState<{ xUrl?: string; instagramUrl?: string; date: string } | null>(null);

  const [reportStep, setReportStep] = useState<'closed' | 'location' | 'pick-map' | 'form'>('closed');
  const [reportLat, setReportLat] = useState<number | null>(null);
  const [reportLng, setReportLng] = useState<number | null>(null);
  const [reportType, setReportType] = useState<'ven' | 'gra' | 'tor'>('ven');
  const [reportDetail, setReportDetail] = useState('');
  const [reportMediaMode, setReportMediaMode] = useState<'file' | 'link'>('file');
  const [reportMediaFile, setReportMediaFile] = useState<File | null>(null);
  const [reportMediaLink, setReportMediaLink] = useState('');
  const [reportCitySearch, setReportCitySearch] = useState('');
  const [reportSending, setReportSending] = useState(false);

  useEffect(() => {
    fetchPrevotsForecasts().then(setPrevotsForecasts).catch(() => setPrevotsForecasts([]));
  }, []);
`;

if (!code.includes('prevotsOverlayVisible')) {
  code = code.replace(/export default function AoVivo2Content\(\) \{/, `export default function AoVivo2Content() {\n${states}`);
}

fs.writeFileSync('app/ao-vivo-2/AoVivo2Content.tsx', code);
console.log('patched prevots states');
