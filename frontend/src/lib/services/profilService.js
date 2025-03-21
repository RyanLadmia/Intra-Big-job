import apiService from './apiService';

/**
 * Service pour gérer les données du profil
 */
const profilService = {
  /**
   * Récupère les données utilisateur pour le profil
   * @returns {Promise<Object>} Les données de l'utilisateur
   */
  getUserData: async () => {
    try {
      const response = await apiService.get('/api/profile/user-data');
      return response.data.data.user;
    } catch (error) {
      console.error('Erreur lors de la récupération des données utilisateur:', error);
      throw error;
    }
  },

  /**
   * Récupère la liste des diplômes de l'utilisateur
   * @returns {Promise<Array>} Liste des diplômes
   */
  getUserDiplomas: async () => {
    try {
      const response = await apiService.get('/api/profile/diplomas');
      return response.data.data.diplomas;
    } catch (error) {
      console.error('Erreur lors de la récupération des diplômes:', error);
      throw error;
    }
  },

  /**
   * Récupère la liste des adresses de l'utilisateur
   * @returns {Promise<Array>} Liste des adresses
   */
  getUserAddresses: async () => {
    try {
      const response = await apiService.get('/api/profile/addresses');
      return response.data.data.addresses;
    } catch (error) {
      console.error('Erreur lors de la récupération des adresses:', error);
      throw error;
    }
  },

  /**
   * Récupère les statistiques de l'utilisateur
   * @returns {Promise<Object>} Statistiques utilisateur
   */
  getUserStats: async () => {
    try {
      const response = await apiService.get('/api/profile/stats');
      return response.data.data.stats;
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques:', error);
      throw error;
    }
  },

  /**
   * Récupère toutes les données du profil en une seule requête
   * @returns {Promise<Object>} Toutes les données du profil
   */
  getAllProfilData: async () => {
    try {
      const response = await apiService.get('/api/profile/all');
      
      // La réponse est déjà response.data, donc vérifiez directement data
      if (response && response.data) {
        return response.data;  // C'est déjà les données extraites
      } else if (response && response.success) {
        // Ou peut-être la structure est différente
        // Essayez de construire l'objet attendu
        return {
          user: response.user,
          diplomas: response.diplomas,
          addresses: response.addresses,
          stats: response.stats
        };
      } else {
        console.error("Structure inattendue:", response);
        return null;
      }
    } catch (error) {
      console.error('Erreur lors de la récupération des données du profil:', error);
      
      // En cas d'échec, essayer de récupérer les données individuellement
      try {
        const [user, diplomas, addresses, stats] = await Promise.all([
          profilService.getUserData(),
          profilService.getUserDiplomas(),
          profilService.getUserAddresses(),
          profilService.getUserStats()
        ]);

        return {
          user,
          diplomas,
          addresses,
          stats
        };
      } catch (fallbackError) {
        console.error('Échec du fallback pour récupérer les données:', fallbackError);
        throw error; // Renvoyer l'erreur originale
      }
    }
  }
};

export default profilService; 