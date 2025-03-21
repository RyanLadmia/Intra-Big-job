import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import apiService, { normalizeApiUrl } from '@/lib/services/apiService';
import { getSessionId } from '@/lib/services/authService';

/**
 * Configuration de base pour les requêtes API
 */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// Special endpoints that need custom handling
const SPECIAL_ENDPOINTS = {
  profilePicture: '/api/profile/picture',
  documents: '/api/documents',
  documentsByType: '/api/documents/type',
  documentUpload: '/api/documents/upload'
};

/**
 * Préfixer les clés de requête avec l'ID de session
 * Cette fonction permet d'isoler les requêtes entre différentes sessions d'utilisateurs
 * @param {Array|string} queryKey - Clé de requête originale
 * @returns {Array} - Clé de requête préfixée avec l'ID de session
 */
const prefixQueryKey = (queryKey) => {
  const sessionId = getSessionId();
  const finalQueryKey = Array.isArray(queryKey) ? queryKey : [queryKey];
  return ['session', sessionId, ...finalQueryKey];
};

/**
 * Hook pour effectuer des requêtes GET avec mise en cache
 * @param {string} endpoint - Endpoint de l'API
 * @param {Array|string} queryKey - Clé pour identifier la requête dans le cache
 * @param {Object} options - Options supplémentaires pour useQuery
 * @returns {Object} - Résultat de useQuery
 */
export function useApiQuery(endpoint, queryKey, options = {}) {
  // Préfixer la clé de requête avec l'ID de session pour isoler les données entre utilisateurs
  const finalQueryKey = prefixQueryKey(queryKey);
  
  // Determine if this is a special endpoint that needs custom handling
  const isProfilePicture = endpoint === SPECIAL_ENDPOINTS.profilePicture;
  const isDocumentEndpoint = 
    endpoint.startsWith(SPECIAL_ENDPOINTS.documents) || 
    endpoint.startsWith(SPECIAL_ENDPOINTS.documentsByType);
  
  // Set appropriate options for special endpoints
  if (isProfilePicture || isDocumentEndpoint) {
    options.staleTime = 0; // Always consider stale
    options.refetchOnMount = true;
    options.refetchOnWindowFocus = true;
    
    // Optimiser la récupération des images de profil
    if (isProfilePicture) {
      // Ajouter des options spécifiques pour les requêtes de photo de profil
      options.retry = 1;        // Limiter les tentatives
      options.retryDelay = 500; // Attendre moins avant de réessayer
      options.refetchInterval = false; // Désactiver le refetch automatique
      options.refetchOnReconnect = false; // Ne pas refetch automatiquement lors de la reconnexion
    }
  }
  
  return useQuery({
    queryKey: finalQueryKey,
    queryFn: async () => {
      try {
        // Add timestamp for special endpoints to prevent browser caching
        const queryParams = (isProfilePicture || isDocumentEndpoint) ? { _t: Date.now() } : {};
        
        // Configure timeout based on endpoint type
        const timeout = isProfilePicture ? 5000 : // 5s pour les images de profil
                        isDocumentEndpoint ? 8000 : // 8s pour les documents
                        15000; // 15s par défaut
        
        // Use the enhanced cache system from apiService
        return await apiService.get(endpoint, { 
          params: queryParams,
          timeout, // Appliquer le timeout configuré
          retries: isProfilePicture ? 1 : 2 // Limiter les retries pour les images de profil
        }, true, options.staleTime || 5 * 60 * 1000);
      } catch (error) {
        // Si c'est une erreur de timeout pour une image de profil, retourner un avatar par défaut
        if (isProfilePicture && error.code === 'ECONNABORTED') {
          console.warn('Profile picture request timed out, using default avatar');
          return { url: '/assets/default-avatar.svg' }; // Retourner l'avatar SVG par défaut
        }
        throw error;
      }
    },
    ...options
  });
}

/**
 * Hook pour effectuer des requêtes POST/PUT/DELETE avec invalidation du cache
 * @param {string} endpoint - Endpoint de l'API
 * @param {string} method - Méthode HTTP (post, put, delete)
 * @param {Array|string} invalidateQueryKey - Clé à invalider après mutation
 * @param {Object} options - Options supplémentaires pour useMutation
 * @returns {Object} - Résultat de useMutation
 */
export function useApiMutation(endpoint, method = 'post', invalidateQueryKey, options = {}) {
  const queryClient = useQueryClient();
  
  // Préfixer la clé d'invalidation avec l'ID de session
  let finalInvalidateKey = null;
  if (invalidateQueryKey) {
    finalInvalidateKey = prefixQueryKey(invalidateQueryKey);
  }
  
  // Determine if this is a special endpoint
  const isProfilePicture = typeof endpoint === 'string' && endpoint === SPECIAL_ENDPOINTS.profilePicture;
  const isDocumentUpload = 
    (typeof endpoint === 'string' && endpoint.includes('/documents/upload')) || 
    (typeof endpoint === 'string' && endpoint.startsWith(SPECIAL_ENDPOINTS.documentUpload));
  const isDocumentDelete = 
    (typeof endpoint === 'function' && endpoint().includes('/documents/')) || 
    (typeof endpoint === 'string' && endpoint.includes('/documents/') && method.toLowerCase() === 'delete');
  
  return useMutation({
    mutationFn: async (data) => {
      try {
        // Determine the actual endpoint URL
        let finalEndpoint = endpoint;
        
        // If endpoint is a function, call it with the data to get the dynamic endpoint
        if (typeof endpoint === 'function') {
          finalEndpoint = endpoint(data);
        }
        
        // For DELETE requests with an ID, append the ID to the endpoint if it's a simple value
        if (method.toLowerCase() === 'delete' && typeof data !== 'object' && finalEndpoint === endpoint) {
          finalEndpoint = `${finalEndpoint}/${data}`;
        }
        
        // Add timestamp for special operations to prevent caching issues
        if (isProfilePicture || isDocumentUpload || isDocumentDelete) {
          const timestamp = Date.now();
          if (method.toLowerCase() === 'delete' || method.toLowerCase() === 'get') {
            finalEndpoint = `${finalEndpoint}${finalEndpoint.includes('?') ? '&' : '?'}_t=${timestamp}`;
          }
        }
        
        // Handle different HTTP methods appropriately
        let response;
        
        if (method.toLowerCase() === 'delete') {
          // Pour les requêtes DELETE
          response = await apiService.delete(finalEndpoint, {
            data: typeof data === 'object' ? data : {}
          });
        } else if (method.toLowerCase() === 'get') {
          // Pour les requêtes GET
          response = await apiService.get(finalEndpoint, { params: data });
        } else if (method.toLowerCase() === 'put') {
          // Pour les requêtes PUT
          response = await apiService.put(finalEndpoint, data);
        } else {
          // Pour les requêtes POST
          response = await apiService.post(finalEndpoint, data);
        }
        
        return response;
      } catch (error) {
        console.error(`Erreur lors de la requête ${method.toUpperCase()} vers ${endpoint}:`, error);
        throw error;
      }
    },
    onSuccess: (data, variables, context) => {
      // Invalider les requêtes associées pour forcer un rafraîchissement
      if (finalInvalidateKey) {
        // For special operations, use a more aggressive invalidation strategy
        if (isProfilePicture) {
          // Invalidate all profile-related queries
          apiService.invalidateProfileCache();
          
          // Invalidate specific keys with immediate refetch
          queryClient.invalidateQueries({ 
            queryKey: finalInvalidateKey,
            refetchType: 'all' // Force refetch even for inactive queries
          });
          
          // Also invalidate any profile-related queries using the session prefix pattern
          const sessionId = getSessionId();
          queryClient.invalidateQueries({
            predicate: (query) => {
              const key = query.queryKey;
              return Array.isArray(key) && 
                key[0] === 'session' && 
                key[1] === sessionId && 
                (key.includes('profile') || 
                 key.includes('profilePicture') || 
                 key.includes('currentProfile'));
            },
            refetchType: 'all'
          });
        } else if (isDocumentUpload || isDocumentDelete) {
          // Invalidate document cache
          apiService.invalidateDocumentCache();
          
          // Invalidate specific keys with immediate refetch
          queryClient.invalidateQueries({ 
            queryKey: finalInvalidateKey,
            refetchType: 'all'
          });
          
          // Also invalidate any document-related queries using the session prefix pattern
          const sessionId = getSessionId();
          queryClient.invalidateQueries({
            predicate: (query) => {
              const key = query.queryKey;
              return Array.isArray(key) && 
                key[0] === 'session' && 
                key[1] === sessionId &&
                (key.includes('document') || 
                 key.includes('userCVDocument') || 
                 key.includes('documents'));
            },
            refetchType: 'all'
          });
        } else {
          // Standard invalidation for other endpoints
          queryClient.invalidateQueries({ 
            queryKey: finalInvalidateKey,
            refetchType: 'all'
          });
        }
      }
      
      // Appeler onSuccess des options si défini
      if (options.onSuccess) {
        options.onSuccess(data, variables, context);
      }
    },
    ...options
  });
}

/**
 * Hook pour la pagination infinie
 * @param {string} endpoint - Endpoint de l'API
 * @param {Array|string} queryKey - Clé pour identifier la requête dans le cache
 * @param {Function} getNextPageParam - Fonction pour obtenir le paramètre de la page suivante
 * @param {Object} options - Options supplémentaires pour useInfiniteQuery
 * @returns {Object} - Résultat de useInfiniteQuery
 */
export function useApiInfiniteQuery(endpoint, queryKey, getNextPageParam, options = {}) {
  // Préfixer la clé de requête avec l'ID de session
  const finalQueryKey = prefixQueryKey(queryKey);
  
  return useInfiniteQuery({
    queryKey: finalQueryKey,
    queryFn: async ({ pageParam }) => {
      try {
        const url = normalizeApiUrl(endpoint);
        const separator = url.includes('?') ? '&' : '?';
        const paginatedUrl = pageParam ? `${endpoint}${separator}${pageParam}` : endpoint;
        
        return await apiService.get(paginatedUrl);
      } catch (error) {
        throw error;
      }
    },
    getNextPageParam,
    ...options
  });
}

/**
 * Hook pour précharger des données dans le cache
 * @param {string} endpoint - Endpoint de l'API
 * @param {Array|string} queryKey - Clé pour identifier la requête dans le cache
 */
export function usePrefetchQuery(endpoint, queryKey) {
  const queryClient = useQueryClient();
  // Préfixer la clé de requête avec l'ID de session
  const finalQueryKey = prefixQueryKey(queryKey);
  
  const prefetch = async () => {
    try {
      await queryClient.prefetchQuery({
        queryKey: finalQueryKey,
        queryFn: async () => {
          return await apiService.get(endpoint);
        }
      });
    } catch (error) {
      // Silently handle error
    }
  };
  
  return { prefetch };
} 