
export const PREDEFINED_LAYERS = [
  // WPC Surface
  { id: 'wpc_surface', name: 'Análise de Superfície', category: 'Superfície WPC' },
  // SPC Surface
  { id: 'spc_temperature', name: 'Temperatura (2m)', category: 'Superfície SPC' },
  { id: 'spc_dewpoint', name: 'Ponto de Orvalho (2m)', category: 'Superfície SPC' },
  { id: 'spc_msl_pressure', name: 'Pressão Nível do Mar / Vento', category: 'Superfície SPC' },
  { id: 'spc_moisture', name: 'Convergência de Umidade', category: 'Superfície SPC' },
  // SPC Upper Air
  { id: 'spc_850mb', name: 'Análise 850mb', category: 'Ar Superior SPC' },
  { id: 'spc_700mb', name: 'Análise 700mb', category: 'Ar Superior SPC' },
  { id: 'spc_500mb', name: 'Análise 500mb', category: 'Ar Superior SPC' },
  { id: 'spc_300mb', name: 'Análise 300mb', category: 'Ar Superior SPC' },
  // Thermodynamics
  { id: 'spc_sbcape', name: 'SBCAPE / SBCIN', category: 'Termodinâmica SPC' },
  { id: 'spc_mlcape', name: 'MLCAPE / MLCIN', category: 'Termodinâmica SPC' },
  { id: 'spc_mucape', name: 'MUCAPE', category: 'Termodinâmica SPC' },
  // Shear
  { id: 'spc_effective_shear', name: 'Cisalhamento Efetivo', category: 'Cisalhamento' },
  { id: 'spc_0_6km_shear', name: 'Cisalhamento 0-6km', category: 'Cisalhamento' },
  { id: 'spc_srh', name: 'Helicidade Relativa (SRH)', category: 'Cisalhamento' },
  // Composite Parameters (New)
  { id: 'spc_stp', name: 'Parâmetro Tornado Sig. (STP)', category: 'Parâmetros Compostos' },
  { id: 'spc_scp', name: 'Parâmetro Supercélula (SCP)', category: 'Parâmetros Compostos' },
] as const;

export const LAYER_CATEGORIES = [
  'Superfície WPC',
  'Superfície SPC',
  'Ar Superior SPC',
  'Termodinâmica SPC',
  'Cisalhamento',
  'Parâmetros Compostos',
] as const;

export const LAYER_TIMES = ['00Z', '03Z', '06Z', '09Z', '12Z', '15Z', '18Z', '21Z', '00Z (+1)'];

export const PREVISAO_SCORING = {
  // New Scoring System Constants
  RADIUS_KM: 100, // 100km circular range
  
  // Precision Score (The Dot) - SIGNIFICANTLY INCREASED
  // If you hit a tornado dead-on, you should win regardless of cluster farming.
  PRECISION_MAX_POINTS: 10000, 
  
  // Cluster Score (The Area)
  CLUSTER_PER_REPORT_MAX: 100,
  
  // Weights by Type (Tornado is ABSOLUTE king)
  // Wind/Hail are effectively worth nothing unless you hit hundreds of them.
  REPORT_WEIGHTS: {
      tornado: 1.0,     // 100% points
      vento: 0.01,      // 1% points (1 point per report max)
      granizo: 0.01     // 1% points
  },
  
  // Streak
  STREAK_THRESHOLD_KM: 100, // Must be within the circle to count for streak
  STREAK_BONUS_MAX: 0.3,
  
  MULTIPLIERS: {
    iniciante: 0.6,
    intermediario: 0.8,
    especialista: 1.0,
    mestre: 1.2,
  },
} as const;

/** IDs de usuários (Firebase Auth UID) que não devem receber requisição de localização */
export const LOCATION_REQUEST_EXCLUDED_UIDS = [
  'cnwkGiUN4cYGi8h5TCsXHdaft3s1',
];

// Lista de emails que têm permissão de ADMIN
export const ADMIN_EMAILS = [
  'stormchasermt@gmail.com', // Criador do App
  'admin@previsaomaster.com'
];

// Google Maps Dark Style (Dark Matter-ish)
export const MAP_STYLE_DARK = [
  { elementType: "geometry", stylers: [{ color: "#212121" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#757575" }],
  },
  {
    featureType: "administrative.province",
    elementType: "geometry.stroke",
    stylers: [{ color: "#ffffff" }, { weight: 0.8 }, { visibility: "on" }],
  },
  {
    featureType: "administrative.country",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9e9e9e" }],
  },
  {
    featureType: "administrative.land_parcel",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#bdbdbd" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#757575" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#181818" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#616161" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#1b1b1b" }],
  },
  {
    featureType: "road",
    elementType: "geometry.fill",
    stylers: [{ color: "#2c2c2c" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8a8a8a" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#373737" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.fill",
    stylers: [{ color: "#f59e0b" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#212121" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#ffffff" }],
  },
  {
    featureType: "road.highway.controlled_access",
    elementType: "geometry.fill",
    stylers: [{ color: "#f97316" }],
  },
  {
    featureType: "road.highway.controlled_access",
    elementType: "geometry.stroke",
    stylers: [{ color: "#212121" }],
  },
  {
    featureType: "road.local",
    elementType: "labels.text.fill",
    stylers: [{ color: "#616161" }],
  },
  {
    featureType: "transit",
    elementType: "labels.text.fill",
    stylers: [{ color: "#757575" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#000000" }]
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#3d3d3d" }],
  },
];

