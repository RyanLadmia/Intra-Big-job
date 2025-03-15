import { BrowserRouter as Router, Routes, Route, useLocation, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { lazy, Suspense, useState, useEffect } from 'react'
import MainLayout from './components/MainLayout'
import { RoleProvider, RoleDashboardRedirect } from './features/roles'
import { LoadingAnimationNoText } from './components/ui/LoadingAnimation'

// Import différé des pages pour améliorer les performances
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const RegistrationSuccess = lazy(() => import('./pages/RegistrationSuccess'))
const VerificationSuccess = lazy(() => import('./pages/VerificationSuccess'))
const VerificationError = lazy(() => import('./pages/VerificationError'))

// Lazy loading pour le Profil et Dashboard
const SettingsProfile = lazy(() => import('./pages/Global/Profile/views/SettingsProfile'))
const SecuritySettings = lazy(() => import('./pages/Global/Profile/views/SecuritySettings'))
const NotificationSettings = lazy(() => import('./pages/Global/Profile/views/NotificationSettings'))
const CareerSettings = lazy(() => import('./pages/Global/Profile/views/CareerSettings'))
const ProfileView = lazy(() => import('./pages/Global/Profile/views/ProfileView'))
const Dashboard = lazy(() => import('./pages/Dashboard'))

// Dashboards spécifiques par rôle
const AdminDashboard = lazy(() => import('./pages/Admin/Dashboard'))
const StudentDashboard = lazy(() => import('./pages/Student/Dashboard'))
// Pages étudiantes
const StudentSchedule = lazy(() => import('./pages/Student/Schedule'))
const StudentGrades = lazy(() => import('./pages/Student/Grades'))
const StudentAbsences = lazy(() => import('./pages/Student/Absences'))
const StudentProjects = lazy(() => import('./pages/Student/Projects'))
const TeacherDashboard = lazy(() => import('./pages/Teacher/Dashboard'))
const HRDashboard = lazy(() => import('./pages/HR/Dashboard'))
const SuperAdminDashboard = lazy(() => import('./pages/SuperAdmin/Dashboard'))
const GuestDashboard = lazy(() => import('./pages/Guest/Dashboard'))
const RecruiterDashboard = lazy(() => import('./pages/Recruiter/Dashboard'))

// Import du composant HomePage 
const HomePage = lazy(() => import('./components/HomePage'))

import { Toaster } from './components/ui/sonner'
import './index.css'
import ProtectedRoute from './components/ProtectedRoute'
import PublicRoute from './components/PublicRoute'
import ProfileLayout from '@/layouts/ProfileLayout'
import useLoadingIndicator from './hooks/useLoadingIndicator'

// Fonction optimisée pour le préchargement intelligent des pages
// Ne charge que les pages pertinentes en fonction du contexte et du chemin actuel
const useIntelligentPreload = () => {
  const location = useLocation();
  const currentPath = location.pathname;
  
  useEffect(() => {
    // Fonction pour précharger des composants spécifiques
    const preloadComponent = (getComponent) => {
      // Précharger immédiatement sans délai
      getComponent();
    };
    
    // Préchargement basé sur le chemin actuel
    if (currentPath.includes('/login') || currentPath === '/') {
      // Sur la page de login, précharger le dashboard et l'enregistrement
      preloadComponent(() => import('./pages/Dashboard'));
      preloadComponent(() => import('./pages/Register'));
    } 
    else if (currentPath.includes('/register')) {
      // Sur la page d'enregistrement, précharger la confirmation
      preloadComponent(() => import('./pages/RegistrationSuccess'));
    }
    else if (currentPath.includes('/profile')) {
      // Sur le profil, précharger les sous-pages de profil
      const profilePath = currentPath.split('/').pop();
      
      // Préchargement contextuel des vues de profil
      if (profilePath === 'settings') {
        preloadComponent(() => import('./pages/Global/Profile/views/SecuritySettings'));
      } 
      else if (profilePath === 'security') {
        preloadComponent(() => import('./pages/Global/Profile/views/NotificationSettings'));
      }
      else {
        // Précharger la page de paramètres par défaut
        preloadComponent(() => import('./pages/Global/Profile/views/SettingsProfile'));
      }
    }
    // Préchargement pour les routes spécifiques aux rôles
    else if (currentPath.includes('/admin')) {
      preloadComponent(() => import('./pages/Admin/Dashboard'));
    }
    else if (currentPath.includes('/student')) {
      preloadComponent(() => import('./pages/Student/Dashboard'));
      preloadComponent(() => import('./pages/Student/Schedule'));
    }
    else if (currentPath.includes('/teacher')) {
      preloadComponent(() => import('./pages/Teacher/Dashboard'));
    }
  }, [currentPath]);
  
  return null;
};

// Composant pour gérer les préchargements
const PrefetchHandler = () => {
  useIntelligentPreload();
  const location = useLocation();
  
  useEffect(() => {
    // Précharger les données utilisateur dès que l'utilisateur est authentifié
    if (localStorage.getItem('token')) {
      Promise.all([
        import('./hooks/useDashboardQueries'),
        import('./lib/services/queryClient'),
        import('./lib/services/authService')
      ]).then(([dashboardModule, queryClientModule, authModule]) => {
        const { getQueryClient } = queryClientModule;
        const { getSessionId } = authModule;
        const qc = getQueryClient();
        const sessionId = getSessionId();
        
        if (qc) {
          // Précharger les données utilisateur
          qc.prefetchQuery({
            queryKey: ['user-data', 'anonymous', sessionId],
            queryFn: async () => {
              const { default: apiService } = await import('./lib/services/apiService');
              return await apiService.get('/me', {}, true, 30 * 60 * 1000);
            },
            staleTime: 30 * 60 * 1000,
            cacheTime: 60 * 60 * 1000
          });
        }
      });
    }
  }, [location.pathname]);
  
  // Ajouter un écouteur d'événement pour forcer l'actualisation des données utilisateur lors d'un changement d'utilisateur
  useEffect(() => {
    const handleUserChange = () => {
      // Importer dynamiquement les modules nécessaires
      Promise.all([
        import('./lib/services/queryClient'),
        import('./lib/services/authService')
      ]).then(([queryClientModule, authModule]) => {
        const { getQueryClient } = queryClientModule;
        const { getSessionId } = authModule;
        const qc = getQueryClient();
        const sessionId = getSessionId();
        
        if (qc) {
          // Invalider toutes les requêtes liées à l'utilisateur
          qc.invalidateQueries({ queryKey: ['user-data'] });
          
          // Invalider également les requêtes de dashboard
          qc.invalidateQueries({ queryKey: ['teacher-dashboard'] });
          qc.invalidateQueries({ queryKey: ['admin-users'] });
          qc.invalidateQueries({ queryKey: ['admin-dashboard'] });
          qc.invalidateQueries({ queryKey: ['student-dashboard'] });
          qc.invalidateQueries({ queryKey: ['hr-dashboard'] });
        }
      });
    };
    
    // Fonction pour gérer le nettoyage complet du cache
    const handleCacheCleared = () => {
      // Forcer un rafraîchissement complet des données
      // Cette approche est plus radicale mais garantit que les anciennes données ne persistent pas
      window.location.reload();
    };
    
    // Ajouter les écouteurs d'événements
    window.addEventListener('login-success', handleUserChange);
    window.addEventListener('role-change', handleUserChange);
    window.addEventListener('query-cache-cleared', handleCacheCleared);
    
    // Nettoyer les écouteurs d'événements
    return () => {
      window.removeEventListener('login-success', handleUserChange);
      window.removeEventListener('role-change', handleUserChange);
      window.removeEventListener('query-cache-cleared', handleCacheCleared);
    };
  }, []);
  
  return null;
};

// Fallback élégant pour Suspense
const SuspenseFallback = () => (
  <div className="flex items-center justify-center min-h-screen loading-animation-container initially-loading">
    <div className="relative w-32 h-32">
      {/* Subtle background glow */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#f0f4f8] to-[#e6edf5] blur-xl opacity-70"></div>
      
      {/* Dashed circle */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="#d0dbe6"
          strokeWidth="1"
          strokeDasharray="3,3"
          strokeLinecap="round"
        />
      </svg>
      
      {/* Static dots around the circle */}
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        const radius = 40;
        const x = 50 + Math.cos(angle) * radius;
        const y = 50 + Math.sin(angle) * radius;
        const size = i % 3 === 0 ? 3.5 : i % 3 === 1 ? 3 : 2.5;
        const colors = ["#02284f", "#528eb2", "#7baac5", "#a0b4c3"];
        
        return (
          <svg key={i} className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
            <circle
              cx={x}
              cy={y}
              r={size}
              fill={colors[i % 4]}
              opacity={i % 2 === 0 ? 0.9 : 0.7}
            />
          </svg>
        );
      })}
      
      {/* Center white dot with glow */}
      <div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full" 
        style={{ 
          boxShadow: '0 0 15px 5px rgba(255, 255, 255, 0.6), 0 0 20px 10px rgba(255, 255, 255, 0.3)' 
        }}
      ></div>
      
      {/* Thin circle outline */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full border border-[#d0dbe6]/30"
      ></div>
    </div>
  </div>
);

// Composant de contenu principal qui utilise les hooks de React Router
const AppContent = () => {
  const [isNavigating, setIsNavigating] = useState(false);
  const navigate = useNavigate();
  
  // Use the loading indicator hook to hide the browser's default loading indicator
  useLoadingIndicator();

  // Écouteur d'événement pour la navigation après déconnexion
  useEffect(() => {
    const handleLogoutNavigation = (event) => {
      const { redirectTo } = event.detail;
      
      // Naviguer directement sans transition
      navigate(redirectTo);
    };
    
    window.addEventListener('auth-logout-success', handleLogoutNavigation);
    
    return () => {
      window.removeEventListener('auth-logout-success', handleLogoutNavigation);
    };
  }, [navigate]);

  return (
    <div className="relative font-poppins">
      <PrefetchHandler />
      {/* Wrapper pour le contenu principal avec z-index positif */}
      <div className="relative z-10">
        <Suspense fallback={<SuspenseFallback />}>
          <RoleProvider>
            {/* Supprimer la classe de transition */}
            <div>
              <Routes>
                {/* Structure révisée: MainLayout englobe toutes les routes pour préserver la navbar */}
                <Route element={<MainLayout />}>
                  {/* Route racine avec redirection automatique */}
                  <Route path="/" element={<HomePage />} />
                  
                  {/* Routes publiques - Accès interdit aux utilisateurs authentifiés */}
                  <Route element={<PublicRoute />}>
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/registration-success" element={<RegistrationSuccess />} />
                    <Route path="/verification-success" element={<VerificationSuccess />} />
                    <Route path="/verification-error" element={<VerificationError />} />
                  </Route>
                  
                  <Route element={<ProtectedRoute />}>
                    {/* Regular protected routes */}
                    <Route path="/dashboard" element={<RoleDashboardRedirect />} />
                    
                    {/* Profile view route */}
                    <Route path="/profile" element={<ProfileView />} />
                    <Route path="/profile/:userId" element={<ProfileView />} />
                    
                    {/* Settings routes avec ProfileLayout */}
                    <Route element={<ProfileLayout />}>
                      <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
                      <Route path="/settings/profile" element={<SettingsProfile />} />
                      <Route path="/settings/career" element={<CareerSettings />} />
                      <Route path="/settings/security" element={<SecuritySettings />} />
                      <Route path="/settings/notifications" element={<NotificationSettings />} />
                    </Route>
                    
                    {/* Dashboards spécifiques par rôle */}
                    <Route path="/admin/dashboard" element={<AdminDashboard />} />
                    
                    {/* Routes étudiantes */}
                    <Route path="/student">
                      <Route path="dashboard" element={<StudentDashboard />} />
                      <Route path="schedule" element={<StudentSchedule />} />
                      <Route path="grades" element={<StudentGrades />} />
                      <Route path="absences" element={<StudentAbsences />} />
                      <Route path="projects" element={<StudentProjects />} />
                    </Route>
                    
                    <Route path="/teacher/dashboard" element={<TeacherDashboard />} />
                    <Route path="/hr/dashboard" element={<HRDashboard />} />
                    <Route path="/superadmin/dashboard" element={<SuperAdminDashboard />} />
                    <Route path="/guest/dashboard" element={<GuestDashboard />} />
                    <Route path="/recruiter/dashboard" element={<RecruiterDashboard />} />
                  </Route>
                  
                  {/* Redirection des routes inconnues vers la page d'accueil */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </div>
          </RoleProvider>
          <Toaster />
        </Suspense>
      </div>
    </div>
  );
};

// Composant App principal qui configure le Router
const App = () => {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppContent />
    </Router>
  );
};

export default App;