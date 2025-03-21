import axiosInstance from '@/lib/axios';
import apiService from './apiService';
import { clearQueryCache, getQueryClient } from '../utils/queryClientUtils';
import { showGlobalLoader, hideGlobalLoader } from '../utils/loadingUtils';
import { toast } from 'sonner';

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

// Générer un identifiant de session unique
export const generateSessionId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

// Stocker l'identifiant de session actuel
let currentSessionId = localStorage.getItem('session_id') || generateSessionId();

// Exposer l'identifiant de session pour l'utiliser dans les clés de requête
export const getSessionId = () => currentSessionId;

// Lazy loading des informations utilisateur
let userDataPromise = null;

/**
 * Décode un token JWT
 * @param {string} token - Le token JWT à décoder
 * @returns {Object|null} - Le contenu décodé du token ou null si invalide
 */
function decodeToken(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Erreur lors du décodage du token:', error);
    return null;
  }
}

/**
 * Service pour l'authentification et la gestion des utilisateurs
 */
export const authService = {
  /**
   * Inscription d'un nouvel utilisateur
   * @param {Object} userData - Données de l'utilisateur
   * @returns {Promise<Object>} - Réponse de l'API
   */
  async register(userData) {
    try {
      console.log('[authService] Début de l\'inscription:', { ...userData, password: '***' });
      const response = await apiService.post('/register', userData);
      
      console.log('[authService] Inscription réussie:', response);
      
      // Si la réponse contient un token (certaines API peuvent fournir un token immédiatement)
      if (response && response.token) {
        localStorage.setItem('token', response.token);
      }
      
      // Retourner une réponse formatée avec un status 201 si l'API ne renvoie pas de statut
      return {
        status: response.status || 201,
        data: response
      };
    } catch (error) {
      console.error('[authService] Erreur lors de l\'inscription:', error);
      console.error('[authService] Détails:', error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * Connexion d'un utilisateur
   * @param {string} email - Email de l'utilisateur
   * @param {string} password - Mot de passe
   * @returns {Promise<Object>} - Réponse de l'API avec token JWT
   */
  async login(email, password) {
    try {
      // Only invalidate instead of removing queries - faster operation
      const queryClient = getQueryClient();
      if (queryClient) {
        queryClient.invalidateQueries({ queryKey: ['user'] });
        queryClient.invalidateQueries({ queryKey: ['profile'] });
      }
      
      // Set login in progress flag to prevent non-critical API calls
      sessionStorage.setItem('login_in_progress', 'true');
      
      // Obtain device ID and info
      const deviceId = getOrCreateDeviceId();
      const { deviceName, deviceType } = getDeviceInfo();
      
      // Clean up previous user data
      localStorage.removeItem('token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user');
      
      // Generate a new session ID
      currentSessionId = generateSessionId();
      localStorage.setItem('session_id', currentSessionId);
      
      // Show loader with no delay
      showGlobalLoader();
      
      // Prepare data for the standard JWT route (/login_check)
      const loginData = {
        username: email, // Note the field 'username' instead of 'email' for JWT standard
        password,
        device_id: deviceId,
        device_name: deviceName,
        device_type: deviceType
      };
      
      // Use JWT standard route directly
      const response = await apiService.post('/login_check', loginData);
      
      // Store JWT token in localStorage
      if (response.token) {
        localStorage.setItem('token', response.token);
      }
      
      // Store refresh token if present
      if (response.refresh_token) {
        localStorage.setItem('refresh_token', response.refresh_token);
      }
      
      // Store user information if present in response
      if (response.user) {
        localStorage.setItem('user', JSON.stringify(response.user));
      }
      
      // Extract detailed info from JWT token for immediate use
      if (response.token) {
        try {
          const tokenParts = response.token.split('.');
          if (tokenParts.length === 3) {
            const payload = JSON.parse(atob(tokenParts[1]));
            
            if (payload.roles) {
              // Create enhanced user object with token information
              const enhancedUser = {
                username: payload.username,
                roles: payload.roles,
                // Extract additional information if available
                id: payload.id,
                email: payload.username,
                firstName: payload.firstName,
                lastName: payload.lastName,
                // Add token extraction timestamp for tracking freshness
                _extractedAt: Date.now()
              };
              
              localStorage.setItem('user', JSON.stringify(enhancedUser));
              
              // IMPORTANT: Also store roles separately in localStorage
              localStorage.setItem('userRoles', JSON.stringify(payload.roles));
              
              // Pre-populate cache with this minimal data to speed up initial rendering
              if (queryClient) {
                queryClient.setQueryData(['user', 'current'], enhancedUser);
              }
              
              // Trigger the login success event immediately
              window.dispatchEvent(new Event('login-success'));
            }
          }
        } catch (tokenError) {
          // Silently handle token parsing errors
          console.error('Error parsing token:', tokenError);
        }
      }
      
      // Initiate user data loading in the background without awaiting or delaying navigation
      setTimeout(() => {
        this.lazyLoadUserData().catch(() => {
          // Silently ignore any errors in background loading
        });
        
        // Clear login in progress flag after background operations complete
        setTimeout(() => {
          sessionStorage.removeItem('login_in_progress');
        }, 1000);
      }, 500);
      
      return response;
    } catch (error) {
      // Clear login in progress flag on error
      sessionStorage.removeItem('login_in_progress');
      
      hideGlobalLoader();
      console.error('Erreur lors de la connexion:', error);
      console.error('Détails de l\'erreur:', error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * Charge les données utilisateur en arrière-plan
   * @returns {Promise<Object>} - Données utilisateur complètes
   */
  async lazyLoadUserData() {
    const cachedUser = this.getUser();
    if (!cachedUser) return null;
    
    try {
      // Create a timeout promise with much shorter timeout (2 seconds)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('User data fetch timeout'));
        }, 2000);
      });
      
      // Try the correct endpoint format - simplify the path construction
      const correctApiPath = '/profile';
      
      // Fetch user data from API with the corrected path
      const dataPromise = apiService.get(correctApiPath, { 
        noCache: false,    // Use cache if available
        retries: 0,        // Don't retry on failure
        timeout: 2000      // Short timeout
      });
      
      // Race between data fetch and timeout
      const userData = await Promise.race([dataPromise, timeoutPromise]);
      
      if (userData && userData.success !== false) {
        // Update localStorage with complete user data
        const enhancedUser = {
          ...cachedUser,
          ...userData,
          _updatedAt: Date.now()
        };
        
        localStorage.setItem('user', JSON.stringify(enhancedUser));
        
        // Update React Query cache if available
        const queryClient = getQueryClient();
        if (queryClient) {
          queryClient.setQueryData(['user', 'current'], enhancedUser);
        }
        
        return enhancedUser;
      }
      
      // If we reach here, something went wrong but we have cached user data
      return cachedUser;
    } catch (error) {
      console.warn('Failed to load complete user data:', error.message || 'Unknown error');
      
      // Ensure login in progress flag is cleared on error
      sessionStorage.removeItem('login_in_progress');
      
      // Still return cached user data if available
      return cachedUser;
    }
  },

  /**
   * Rafraîchir le token JWT
   * @returns {Promise<Object>} - Nouveau token JWT
   */
  async refreshToken() {
    try {
      const refreshToken = localStorage.getItem('refresh_token');
      const deviceId = localStorage.getItem('device_id');
      const { deviceName, deviceType } = getDeviceInfo();
      
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }
      
      const refreshData = {
        refresh_token: refreshToken,
        device_id: deviceId,
        device_name: deviceName,
        device_type: deviceType
      };
      
      const response = await apiService.post('/token/refresh', refreshData);
      
      if (response.token) {
        localStorage.setItem('token', response.token);
      }
      
      if (response.refresh_token) {
        localStorage.setItem('refresh_token', response.refresh_token);
      }
      
      return response;
    } catch (error) {
      console.error('Erreur lors du rafraîchissement du token:', error);
      console.error('Détails de l\'erreur de rafraîchissement:', error.response?.data || error.message);
      // Si le refresh token est invalide, déconnecter l'utilisateur
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        this.logout();
      }
      throw error;
    }
  },
  
  /**
   * Déconnexion
   * @param {string} [redirectTo='/login'] - Chemin de redirection après la déconnexion
   * @returns {Promise<boolean>} - True si la déconnexion est réussie
   */
  async logout(redirectTo = '/login') {
    try {
      // Set global navigation flags
      window.__isLoggingOut = true;
      window.__isNavigating = true;
      
      // Show global loading state immediately without animation
      showGlobalLoader();
      
      // Clear all localStorage data in one step - do this before API calls
      localStorage.clear();
      sessionStorage.clear();
      
      // Try to revoke refresh token on server side
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        const deviceId = localStorage.getItem('device_id');
        
        if (refreshToken) {
          const revokeData = {
            refresh_token: refreshToken,
            device_id: deviceId
          };
          
          await apiService.post('/token/revoke', revokeData).catch(() => {
            // Ignore errors during token revocation
          });
        }
      } catch (error) {
        // Ignore errors during logout API calls
      }
      
      // Clear all API and query caches
      try {
        // Clear React Query cache
        const queryClient = getQueryClient();
        if (queryClient) {
          queryClient.cancelQueries();
          queryClient.removeQueries();
          clearQueryCache();
        }
        
        // Clear API cache
        apiService.clearCache();
      } catch (error) {
        // Ignore cache clearing errors
      }
      
      // Create a new session ID for next login
      currentSessionId = generateSessionId();
      
      // Trigger the logout success event
      window.dispatchEvent(new CustomEvent('logout-success', {
        detail: { redirectTo }
      }));
      
      // Use the window.location.replace method for a cleaner page transition
      // This replaces the current history entry instead of adding a new one
      setTimeout(() => {
        window.location.replace(redirectTo || '/login');
      }, 10);
      
      return true;
    } catch (error) {
      // Force localStorage cleanup even on error
      localStorage.clear();
      sessionStorage.clear();
      
      // Redirect even on error
      window.location.replace('/login');
      
      return false;
    }
  },
  
  /**
   * Déconnexion de tous les appareils
   */
  async logoutAllDevices() {
    try {
      await apiService.post('/token/revoke-all');
      
      // Nettoyer le localStorage
      localStorage.removeItem('token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user');
      
      // Réinitialiser la promesse de chargement des données utilisateur
      userDataPromise = null;
      
      // Vider le cache React Query
      clearQueryCache();
    } catch (error) {
      console.error('Erreur lors de la déconnexion de tous les appareils:', error);
      console.error('Détails:', error.response?.data || error.message);
      throw error;
    }
  },
  
  /**
   * Récupérer la liste des appareils connectés
   */
  async getDevices() {
    try {
      const devices = await apiService.get('/token/devices');
      return devices;
    } catch (error) {
      console.error('Erreur lors de la récupération des appareils:', error);
      console.error('Détails:', error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * Récupère le token JWT stocké
   * @returns {string|null} - Token JWT ou null
   */
  getToken() {
    return localStorage.getItem('token');
  },

  /**
   * Récupère les informations de l'utilisateur connecté
   * @returns {Object|null} - Informations de l'utilisateur ou null
   */
  getUser() {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },

  /**
   * Vérifie si l'utilisateur est connecté
   * @returns {boolean} - True si connecté
   */
  isLoggedIn() {
    const token = this.getToken();
    if (!token) return false;

    try {
      const decodedToken = decodeToken(token);
      if (!decodedToken) return false;
      
      const currentTime = Date.now() / 1000;
      return decodedToken.exp > currentTime;
    } catch (error) {
      return false;
    }
  },

  /**
   * Vérifie si l'utilisateur a un rôle spécifique
   * @param {string} role - Le rôle à vérifier
   * @returns {boolean} - True si l'utilisateur a le rôle
   */
  hasRole(role) {
    const user = this.getUser();
    if (!user) return false;
    
    // Extraire les rôles de l'utilisateur
    let userRoles = [];
    
    if (Array.isArray(user.roles)) {
      userRoles = user.roles;
    } else if (typeof user.roles === 'object' && user.roles !== null) {
      userRoles = Object.values(user.roles);
    } else if (user.role) {
      userRoles = Array.isArray(user.role) ? user.role : [user.role];
    }
    
    // Normaliser le rôle recherché
    const searchRole = role.toUpperCase().startsWith('ROLE_') ? role.toUpperCase() : `ROLE_${role.toUpperCase()}`;
    
    // Vérifier si l'utilisateur a le rôle spécifié
    return userRoles.some(userRole => {
      // Si le rôle est une chaîne de caractères
      if (typeof userRole === 'string') {
        const normalizedUserRole = userRole.toUpperCase().startsWith('ROLE_') ? 
          userRole.toUpperCase() : 
          `ROLE_${userRole.toUpperCase()}`;
        return normalizedUserRole === searchRole;
      }
      
      // Si le rôle est un objet
      if (typeof userRole === 'object' && userRole !== null) {
        const roleName = userRole.name || userRole.role || userRole.roleName || '';
        const normalizedRoleName = roleName.toUpperCase().startsWith('ROLE_') ? 
          roleName.toUpperCase() : 
          `ROLE_${roleName.toUpperCase()}`;
        return normalizedRoleName === searchRole;
      }
      
      return false;
    });
  },

  /**
   * Récupère les informations complètes de l'utilisateur connecté depuis l'API
   * @param {boolean} [forceRefresh=false] - Force le rafraîchissement des données depuis l'API
   * @returns {Promise<Object>} - Données complètes de l'utilisateur
   */
  async getCurrentUser(forceRefresh = false) {
    const token = this.getToken();
    if (!token) {
      throw new Error('Aucun token d\'authentification trouvé');
    }

    // Si une promesse est déjà en cours et qu'on ne force pas le rafraîchissement, on la retourne
    if (userDataPromise && !forceRefresh) {
      return userDataPromise;
    }

    // Créer une nouvelle promesse pour charger les données utilisateur
    userDataPromise = new Promise(async (resolve, reject) => {
      try {
        // Utiliser le cache sauf si on force le rafraîchissement
        const options = {
          ...(forceRefresh ? { cache: 'no-store' } : {}),
          timeout: 15000, // Ensure 15s timeout is set
          retries: 3 // Allow up to 3 retries
        };
        
        const response = await apiService.get('/api/me', { ...apiService.withAuth(), ...options });
        
        // Extraire l'objet utilisateur si la réponse contient un objet "user"
        let userData = response;
        if (response.user) {
          userData = response.user;
        } else if (response.data) {
          userData = response.data;
        } else if (response.success && response.user) {
          userData = response.user;
        }
        
        // Stocker les données utilisateur dans le localStorage
        localStorage.setItem('user', JSON.stringify(userData));
        
        // Stocker le rôle principal pour référence
        if (userData.roles && userData.roles.length > 0) {
          localStorage.setItem('last_role', userData.roles[0]);
          
          // IMPORTANT: Also store roles array separately
          localStorage.setItem('userRoles', JSON.stringify(userData.roles));
        }
        
        resolve(userData);
      } catch (error) {
        console.error('Error in getCurrentUser:', error);
        userDataPromise = null; // Réinitialiser la promesse en cas d'erreur
        
        // Try to use cached data if available
        const cachedUser = localStorage.getItem('user');
        if (cachedUser) {
          try {
            const userData = JSON.parse(cachedUser);
            resolve(userData);
            return;
          } catch (e) {
            // Invalid cached data
            localStorage.removeItem('user');
          }
        }
        
        reject(error);
      }
    });

    return userDataPromise;
  },
  
  /**
   * Change le mot de passe de l'utilisateur connecté
   * @param {Object} passwordData - Données de changement de mot de passe
   * @param {string} passwordData.currentPassword - Mot de passe actuel
   * @param {string} passwordData.newPassword - Nouveau mot de passe
   * @returns {Promise<Object>} - Réponse de l'API
   */
  async changePassword(passwordData) {
    try {
      const response = await apiService.post('/api/change-password', passwordData, apiService.withAuth());
      return response;
    } catch (error) {
      throw error;
    }
  },

  /**
   * Nettoie toutes les données d'authentification et redirige vers la page de connexion
   * @param {boolean} showNotification - Indique si une notification doit être affichée
   * @param {string} message - Message personnalisé à afficher dans la notification
   */
  clearAuthData(showNotification = true, message = 'Vous avez été déconnecté.') {
    // Supprimer toutes les données d'authentification du localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('refresh_token');
    
    // Afficher une notification si demandé
    if (showNotification) {
      toast.success(message, {
        duration: 3000,
        position: 'top-center',
      });
    }
    
    // Rediriger vers la page de connexion
    window.location.href = '/login';
  },

  // Méthode pour déclencher manuellement une mise à jour des rôles
  triggerRoleUpdate: () => {
    window.dispatchEvent(new Event('role-change'));
    triggerRoleUpdate();
  },

  /**
   * Ensures that all necessary user data is saved to localStorage
   * Call this when encountering issues with missing data
   */
  ensureUserDataInLocalStorage: async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.warn('Cannot ensure user data - no token found');
        return false;
      }
      
      // Check if the current page is the signature page
      const isSignaturePage = window.location.pathname.includes('/student/attendance');
      
      // Get user data from API
      let userData = null;
      try {
        // First try to get from the basic me endpoint
        userData = await authService.getCurrentUser(true);
      } catch (err) {
        console.warn('Failed to get user data from /me endpoint, trying backup methods');
      }
      
      // If we have user data, save it
      if (userData) {
        // Store the actual user data
        localStorage.setItem('user', JSON.stringify(userData));
        
        // Ensure roles are stored
        if (userData.roles && Array.isArray(userData.roles)) {
          // If this is the signature page, ensure STUDENT role is included
          let roles = userData.roles;
          if (isSignaturePage && !roles.includes('ROLE_STUDENT')) {
            roles.push('ROLE_STUDENT'); // Add student role for signature page
          }
          localStorage.setItem('userRoles', JSON.stringify(roles));
        } else {
          // If no roles in response, set default student role for testing
          localStorage.setItem('userRoles', JSON.stringify(['ROLE_STUDENT']));
        }
        
        console.log('Successfully ensured user data in localStorage', {
          userData, 
          roles: JSON.parse(localStorage.getItem('userRoles') || '[]')
        });
        return true;
      }
      
      // If we still don't have user data, create minimal data
      if (!localStorage.getItem('user')) {
        const minimalUser = {
          id: '1',
          email: 'student@example.com',
          firstName: 'Test',
          lastName: 'Student',
          roles: ['ROLE_STUDENT'] // Always include ROLE_STUDENT
        };
        localStorage.setItem('user', JSON.stringify(minimalUser));
      }
      
      // Ensure roles exist - default to student role
      // For signature page, make sure student role is always included
      if (!localStorage.getItem('userRoles') || isSignaturePage) {
        localStorage.setItem('userRoles', JSON.stringify(['ROLE_STUDENT']));
      }
      
      console.log('Created fallback user data in localStorage', {
        user: JSON.parse(localStorage.getItem('user') || '{}'),
        roles: JSON.parse(localStorage.getItem('userRoles') || '[]')
      });
      
      return true;
    } catch (error) {
      console.error('Error ensuring user data:', error);
      return false;
    }
  }
};

// Générer ou récupérer un identifiant unique pour l'appareil
function getOrCreateDeviceId() {
  // Vérifier si un deviceId existe déjà dans le localStorage
  let deviceId = localStorage.getItem('device_id');
  
  // Si non, en créer un nouveau
  if (!deviceId) {
    // Générer un identifiant unique (UUID v4)
    deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    localStorage.setItem('device_id', deviceId);
  }
  
  return deviceId;
}

// Obtenir des informations de base sur l'appareil
function getDeviceInfo() {
  const userAgent = window.navigator.userAgent;
  let deviceType = 'web';
  let deviceName = 'Browser';
  
  // Détection simple du type d'appareil
  if (/Android/i.test(userAgent)) {
    deviceType = 'mobile';
    deviceName = 'Android Device';
  } else if (/iPhone|iPad|iPod/i.test(userAgent)) {
    deviceType = 'mobile';
    deviceName = 'iOS Device';
  } else if (/Windows/i.test(userAgent)) {
    deviceType = 'desktop';
    deviceName = 'Windows Device';
  } else if (/Macintosh/i.test(userAgent)) {
    deviceType = 'desktop';
    deviceName = 'Mac Device';
  } else if (/Linux/i.test(userAgent)) {
    deviceType = 'desktop';
    deviceName = 'Linux Device';
  }
  
  return {
    deviceType,
    deviceName
  };
}

export default authService;
