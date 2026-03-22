import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  pt: {
    translation: {
      "app_title": "Previsão Master",
      "app_subtitle": "O Hub meteorológico da América do Sul",
      "nav_home": "Início",
      "nav_games": "Jogos",
      "nav_tracks": "Rastros de Tornados",
      "nav_live": "Modo Ao Vivo",
      "nav_rules": "Como Funciona",
      "nav_study": "Material de Estudo",
      "nav_project": "Projeto & Dados",
      "nav_ranking": "Ranking",
      "nav_admin": "Painel Admin",
      "btn_login": "Entrar com Google",
      "btn_logout": "Sair da Conta",
      "btn_save": "Salvar",
      "settings_title": "Configurações",
      "settings_account": "Configurações da Conta",
      "settings_sound": "Efeitos Sonoros",
      "settings_music": "Música",
      "profile_title": "Perfil de Usuário",
      "profile_change_username": "Alterar Nome de Usuário",
      "profile_stats": "Estatísticas (Nuvem)",
      "profile_total_score": "Pontuação Total",
      "profile_matches": "Partidas",
      "profile_best_dist": "Melhor Distância",
      "profile_record": "Recorde Pessoal"
    }
  },
  en: {
    translation: {
      "app_title": "Forecast Master",
      "app_subtitle": "South America's Weather Hub",
      "nav_home": "Home",
      "nav_games": "Games",
      "nav_tracks": "Tornado Tracks",
      "nav_live": "Live Mode",
      "nav_rules": "How it Works",
      "nav_study": "Study Material",
      "nav_project": "Project & Data",
      "nav_ranking": "Ranking",
      "nav_admin": "Admin Panel",
      "btn_login": "Sign in with Google",
      "btn_logout": "Sign Out",
      "btn_save": "Save",
      "settings_title": "Settings",
      "settings_account": "Account Settings",
      "settings_sound": "Sound Effects",
      "settings_music": "Music",
      "profile_title": "User Profile",
      "profile_change_username": "Change Username",
      "profile_stats": "Statistics (Cloud)",
      "profile_total_score": "Total Score",
      "profile_matches": "Matches",
      "profile_best_dist": "Best Distance",
      "profile_record": "Personal Best"
    }
  },
  es: {
    translation: {
      "app_title": "Pronóstico Master",
      "app_subtitle": "El Hub meteorológico de América del Sur",
      "nav_home": "Início",
      "nav_games": "Juegos",
      "nav_tracks": "Rastros de Tornados",
      "nav_live": "Modo en Vivo",
      "nav_rules": "Cómo Funciona",
      "nav_study": "Material de Estúdio",
      "nav_project": "Proyecto & Datos",
      "nav_ranking": "Ranking",
      "nav_admin": "Panel Admin",
      "btn_login": "Entrar con Google",
      "btn_logout": "Cerrar Sesión",
      "btn_save": "Guardar",
      "settings_title": "Configuraciones",
      "settings_account": "Configuración de la Cuenta",
      "settings_sound": "Efectos de Sonido",
      "settings_music": "Música",
      "profile_title": "Perfil de Usuario",
      "profile_change_username": "Cambiar Nombre de Usuario",
      "profile_stats": "Estadísticas (Nube)",
      "profile_total_score": "Puntuación Total",
      "profile_matches": "Partidas",
      "profile_best_dist": "Mejor Distancia",
      "profile_record": "Récord Personal"
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'pt',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
