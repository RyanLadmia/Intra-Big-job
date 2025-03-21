import React, { useState, useEffect, useCallback } from 'react';
import { useApiQuery, useApiMutation } from '@/hooks/useReactQuery';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useQueryClient } from '@tanstack/react-query';
import { profileService } from '../services/profileService';
import ProfilePicture from './settings/ProfilePicture';
import { useProfilePicture } from '../hooks/useProfilePicture';
import { isValidEmail, isValidPhone, isValidLinkedInUrl, isValidName, isValidUrl } from '@/lib/utils/validation';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Upload, FileText, Trash2, Send } from 'lucide-react';

// Import our components using the barrel export
import {
  PersonalInformation,
  AdministrativeInformation
} from './settings';

/**
 * UserProfileSettings component that uses React Query to fetch and manage user profile data
 */
const UserProfileSettings = () => {
  // Get the query client instance
  const queryClient = useQueryClient();
  
  // Add state for edit mode and edited data
  const [editMode, setEditMode] = useState({
    personal: false,
    address: false,
    academic: false,
  });
  
  const [editedData, setEditedData] = useState({
    personal: {
      firstName: '',
      lastName: '',
      email: '',
      phoneNumber: '',
      linkedinUrl: '',
      portfolioUrl: '',
      nationality: '',
      birthDate: '',
    },
    address: {},
    academic: {},
  });

  // Fetch user profile data using React Query
  const { 
    data: profileData, 
    isLoading: isProfileLoading, 
    isError: isProfileError,
    error: profileError,
    refetch: refetchProfile
  } = useApiQuery('/profile/consolidated', 'userProfileData', {
    refetchOnWindowFocus: false,
    staleTime: 0, // Ensure we always get fresh data
    cacheTime: 0, // Disable caching to prevent stale data
    timeout: 4000, // Ajouter un timeout de 4 secondes
    onError: (error) => {
      toast.error('Failed to load profile data: ' + (error.response?.data?.message || error.message));
    }
  });

  // Extract user data from the response
  const userData = React.useMemo(() => ({
    ...(profileData?.data?.user || {}),
    addresses: profileData?.data?.addresses || [],
    studentProfile: profileData?.data?.studentProfile || null,
  }), [profileData]);
  
  // Determine if user is a student and get role - memoized to prevent unnecessary recalculations
  const { userRole, isStudent } = React.useMemo(() => {
    const userRoles = userData?.roles || [];
    const rolesArray = Array.isArray(userRoles) 
      ? userRoles 
      : (typeof userRoles === 'object' ? Object.values(userRoles) : []);
    
    const isStudent = rolesArray.some(role => 
      typeof role === 'string' && role.includes('STUDENT')
    ) || (userData.studentProfile && Object.keys(userData.studentProfile).length > 0);
    
    let userRole = '';
    if (isStudent) {
      userRole = 'ROLE_STUDENT';
    } else if (rolesArray.length > 0) {
      const firstRole = rolesArray[0];
      userRole = typeof firstRole === 'object' && firstRole !== null && firstRole.name
        ? firstRole.name
        : String(firstRole);
    }
    
    return { userRole, isStudent };
  }, [userData?.roles, userData?.studentProfile]);

  // Initialize editedData when userData changes
  useEffect(() => {
    if (userData && Object.keys(userData).length > 0) {
      // Use a deep comparison to avoid unnecessary updates
      const newPersonalData = {
        firstName: userData.firstName ?? '',
        lastName: userData.lastName ?? '',
        email: userData.email ?? '',
        phoneNumber: userData.phoneNumber ?? '',
        linkedinUrl: userData.linkedinUrl ?? '',
        portfolioUrl: userData.studentProfile?.portfolioUrl ?? '',
        nationality: userData.nationality ?? '',
        birthDate: userData.birthDate ?? '',
      };
      
      // Only update if the data has actually changed
      if (JSON.stringify(newPersonalData) !== JSON.stringify(editedData.personal)) {
        setEditedData(prev => ({
          ...prev,
          personal: newPersonalData,
          address: {},
          academic: {},
        }));
      }
    }
  }, [profileData]); // Only depend on profileData, not derived values

  // Helper function to calculate age from birthdate
  const calculateAge = (birthDateString) => {
    if (!birthDateString) return null;
    
    try {
      const birthDate = new Date(birthDateString);
      if (isNaN(birthDate.getTime())) return null;
      
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      
      // Adjust age if birthday hasn't occurred yet this year
      const hasBirthdayOccurredThisYear = 
        today.getMonth() > birthDate.getMonth() || 
        (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
      
      return hasBirthdayOccurredThisYear ? age : age - 1;
    } catch (e) {
      // console.error('Error calculating age:', e);
      return null;
    }
  };

  // Function to update local state optimistically
  const updateLocalState = useCallback((field, value) => {
    if (field === 'portfolioUrl') {
      setEditedData(prev => ({
        ...prev,
        personal: {
          ...prev.personal,
          portfolioUrl: value
        }
      }));
      // Update userData immediately for optimistic UI
      if (userData.studentProfile) {
        userData.studentProfile.portfolioUrl = value;
      }
    } else {
      setEditedData(prev => ({
        ...prev,
        personal: {
          ...prev.personal,
          [field]: value
        }
      }));
      // Update userData immediately for optimistic UI
      userData[field] = value;
      
      // If updating birthDate, also update the age
      if (field === 'birthDate' && value) {
        userData.age = calculateAge(value);
      }
    }
  }, [userData]);

  // Handler for saving personal information
  const handleSavePersonal = async (field) => {
    try {
      const value = editedData.personal[field];
      
      // Validation spécifique selon le type de champ
      if (field === 'birthDate' && value) {
        const birthDate = new Date(value);
        const today = new Date();
        const minAgeDate = new Date(today);
        minAgeDate.setFullYear(today.getFullYear() - 16);
        
        if (birthDate > minAgeDate) {
          toast.error("Vous devez avoir au moins 16 ans pour vous inscrire.");
          return;
        }
      }
      
      // Validation de l'email
      if (field === 'email' && value) {
        if (!isValidEmail(value)) {
          toast.error("Format d'email invalide");
          return;
        }
      }
      
      // Validation du numéro de téléphone
      if (field === 'phoneNumber' && value) {
        if (!isValidPhone(value)) {
          toast.error("Format de numéro de téléphone invalide");
          return;
        }
      }
      
      // Validation du nom et prénom
      if ((field === 'firstName' || field === 'lastName') && value) {
        if (!isValidName(value)) {
          toast.error(`Format de ${field === 'firstName' ? 'prénom' : 'nom'} invalide. Utilisez uniquement des lettres, espaces, tirets et apostrophes.`);
          return;
        }
      }

      // Validate LinkedIn URL
      if (field === 'linkedinUrl' && value) {
        if (!isValidLinkedInUrl(value)) {
          toast.error("L'URL LinkedIn doit commencer par 'https://www.linkedin.com/in/'");
          return;
        }
      }

      // Validate portfolio URL
      if (field === 'portfolioUrl' && value) {
        if (!isValidUrl(value)) {
          toast.error("L'URL du portfolio doit commencer par 'https://'");
          return;
        }
      }
      
      // Apply optimistic update immediately
      updateLocalState(field, value);
      
      // Prepare data for saving
      const dataToSave = { [field]: value === '' ? null : value };
      
      // Make the API call in the background
      if (field === 'portfolioUrl' && isStudent) {
        await updatePortfolioUrl({ portfolioUrl: value });
        toast.success('Mise à jour réussie');
      } else {
        await updatePersonalInfo(dataToSave);
        toast.success('Mise à jour réussie');
      }
      
      // If we're updating birthDate, calculate and update the age
      if (field === 'birthDate' && value) {
        userData.age = calculateAge(value);
      }
      
    } catch (error) {
      // Revert optimistic update on error
      if (field === 'portfolioUrl' && isStudent) {
        updateLocalState('portfolioUrl', profileData?.data?.studentProfile?.portfolioUrl || null);
      } else {
        updateLocalState(field, profileData?.data?.user?.[field] || null);
        toast.error(`Erreur lors de la mise à jour de ${field}`);
      }
    }
  };

  // Add a new function to handle address updates
  const handleSaveAddress = async () => {
    try {
      const addressData = editedData.address;
      const formattedAddress = {
        name: addressData.name?.trim() || '',
        complement: addressData.complement?.trim() || null,
        postalCode: {
          code: addressData.postalCode?.code?.trim() || ''
        },
        city: {
          name: addressData.city?.name?.trim() || ''
        }
      };
      
      if (!formattedAddress.name || !formattedAddress.postalCode.code || !formattedAddress.city.name) {
        toast.error('Veuillez remplir tous les champs obligatoires');
        return;
      }
      
      // Créer un objet d'adresse complet avec ID si disponible
      const addressWithId = {
        ...formattedAddress,
        id: userData.addresses?.[0]?.id
      };
      
      // Make the API call first
      await profileService.updateAddress(formattedAddress);
      
      toast.success('Adresse mise à jour avec succès');
      
      // Force refetch to get the latest data from the server
      await queryClient.invalidateQueries({ queryKey: ['userProfileData'] });
      await refetchProfile();
      
    } catch (error) {
      console.error('Error saving address:', error);
      toast.error('Erreur lors de la mise à jour de l\'adresse');
    }
  };

  // Mutation for updating personal information
  const { mutate: updatePersonalInfo } = useApiMutation(
    '/api/profile',
    'put',
    'userProfileData',
    {
      onMutate: async (variables) => {
        // Cancel any outgoing refetches
        await queryClient.cancelQueries({ queryKey: ['userProfileData'] });
        
        // Snapshot the previous value
        const previousData = queryClient.getQueryData(['userProfileData']);
        
        return { previousData };
      },
      onSuccess: (data, variables) => {
        toast.success('Informations mises à jour avec succès');
      },
      onError: (err, variables, context) => {
        // Rollback on error
        queryClient.setQueryData(['userProfileData'], context.previousData);
        toast.error('Une erreur est survenue lors de la mise à jour du profil');
      },
      onSettled: () => {
        // Refetch in the background to ensure sync
        queryClient.invalidateQueries({ queryKey: ['userProfileData'] });
      }
    }
  );

  // Mutation for updating portfolio URL
  const { mutate: updatePortfolioUrl } = useApiMutation(
    '/api/student/profile/portfolio-url',
    'put',
    'userProfileData',
    {
      onMutate: async (variables) => {
        // Cancel any outgoing refetches
        await queryClient.cancelQueries({ queryKey: ['userProfileData'] });
        
        // Snapshot the previous value
        const previousData = queryClient.getQueryData(['userProfileData']);
        
        return { previousData };
      },
      onSuccess: (data, variables) => {
        toast.success('Informations mises à jour avec succès');
      },
      onError: (err, variables, context) => {
        // Rollback on error
        queryClient.setQueryData(['userProfileData'], context.previousData);
        toast.error(err.response?.data?.message || "L'URL du portfolio doit commencer par 'https://'");
      },
      onSettled: () => {
        // Refetch in the background to ensure sync
        queryClient.invalidateQueries({ queryKey: ['userProfileData'] });
      }
    }
  );

  // Fonction pour gérer l'upload de pièces d'identité
  const handleUploadIdentity = async () => {
    try {
      // Créer un élément input caché pour sélectionner le fichier
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.pdf,.jpg,.jpeg,.png';
      fileInput.multiple = false;
      
      // Gérer l'événement de changement lorsqu'un fichier est sélectionné
      fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Vérifier la taille du fichier (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
          toast.error('Le fichier est trop volumineux. La taille maximale est de 5MB.');
          return;
        }
        
        // Vérifier le type du fichier
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
        if (!allowedTypes.includes(file.type)) {
          toast.error('Type de fichier non pris en charge. Utilisez PDF, JPG ou PNG.');
          return;
        }
        
        // Créer un objet FormData pour l'upload
        const formData = new FormData();
        formData.append('document', file);
        
        // Afficher un toast de chargement
        const loadingToast = toast.loading('Upload en cours...');
        
        try {
          // Appel API pour télécharger le document
          await profileService.uploadIdentityDocument(formData);
          
          toast.dismiss(loadingToast);
          toast.success('Document téléchargé avec succès');
          
          // Rafraîchir les données du profil
          queryClient.invalidateQueries({ queryKey: ['userProfileData'] });
          refetchProfile();
          
        } catch (error) {
          toast.dismiss(loadingToast);
          toast.error('Erreur lors du téléchargement du document');
          console.error('Error uploading document:', error);
        }
      };
      
      // Déclencher la sélection de fichier
      fileInput.click();
    } catch (error) {
      console.error('Error initiating file upload:', error);
      toast.error('Erreur lors de l\'initialisation du téléchargement');
    }
  };

  // Fonction pour supprimer un document
  const handleDeleteDocument = async (documentId) => {
    try {
      const loadingToast = toast.loading('Suppression en cours...');
      
      // Appel API pour supprimer le document
      await profileService.deleteIdentityDocument(documentId);
      
      toast.dismiss(loadingToast);
      toast.success('Document supprimé avec succès');
      
      // Rafraîchir les données du profil
      queryClient.invalidateQueries({ queryKey: ['userProfileData'] });
      refetchProfile();
      
    } catch (error) {
      toast.error('Erreur lors de la suppression du document');
      console.error('Error deleting document:', error);
    }
  };

  // Fonction pour envoyer les documents
  const handleSubmitDocuments = async () => {
    try {
      const loadingToast = toast.loading('Envoi des documents en cours...');
      
      // Appel API pour envoyer les documents
      await profileService.submitIdentityDocuments();
      
      toast.dismiss(loadingToast);
      toast.success('Documents envoyés avec succès');
      
      // Rafraîchir les données du profil
      queryClient.invalidateQueries({ queryKey: ['userProfileData'] });
      refetchProfile();
      
    } catch (error) {
      toast.error('Erreur lors de l\'envoi des documents');
      console.error('Error submitting documents:', error);
    }
  };

  // Render loading state
  if (isProfileLoading) {
    return <ProfileSettingsSkeleton />;
  }

  // Render error state
  if (isProfileError) {
    return (
      <div className="space-y-6 bg-white p-6 rounded-lg shadow">
        <div className="text-center py-8">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Error Loading Profile</h2>
          <p className="text-gray-600 mb-4">{profileError?.response?.data?.message || profileError?.message || 'An unexpected error occurred'}</p>
          <Button onClick={() => refetchProfile()}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 w-full">
      <Card className="overflow-hidden w-full">
        <div className="flex flex-col xs:flex-row items-center p-2 xs:p-3">
          <ProfilePicture 
            userData={userData} 
            onProfilePictureChange={() => refetchProfile()}
            isLoading={isProfileLoading}
          />

        </div>
      </Card>

      <Card className="overflow-hidden w-full">
        <CardHeader className="px-4 sm:px-6 md:px-8 py-3 sm:py-4">
          <CardTitle className="text-lg sm:text-xl">Informations personnelles</CardTitle>
          <CardDescription className="text-xs sm:text-sm">Mettre à jour vos informations personnelles</CardDescription>
        </CardHeader>
        <CardContent className="px-3 sm:px-4 md:px-6 pb-6">
          <PersonalInformation 
            userData={userData}
            editMode={editMode}
            setEditMode={setEditMode}
            editedData={editedData}
            setEditedData={setEditedData}
            userRole={userRole}
            onSave={handleSavePersonal}
            onSaveAddress={handleSaveAddress}
            onUploadIdentity={handleUploadIdentity}
            onDeleteDocument={handleDeleteDocument}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-2">
                <Label htmlFor="nationality">Nationalité</Label>
                <Input
                  id="nationality"
                  value={editedData.personal.nationality || ''}
                  onChange={(e) => handleSavePersonal('nationality')}
                  disabled={!editMode.personal}
                  placeholder="Votre nationalité"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="birthDate">Date de naissance</Label>
                <Input
                  id="birthDate"
                  type="date"
                  value={editedData.personal.birthDate || ''}
                  onChange={(e) => handleSavePersonal('birthDate')}
                  disabled={!editMode.personal}
                />
              </div>
            </div>

            {/* Section conditionnelle pour les documents d'identité */}
            <div className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base">
                    {editedData.personal.nationality === 'Français' ? 'Pièces d\'identité' : 'Titre de séjour'}
                  </Label>
                  <p className="text-sm text-gray-500">
                    {editedData.personal.nationality === 'Français' 
                      ? 'Téléchargez vos documents d\'identité'
                      : 'Téléchargez votre titre de séjour'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleUploadIdentity}
                    className="flex items-center gap-2"
                  >
                    <Upload className="h-4 w-4" />
                    Télécharger
                  </Button>
                  {userData.identityDocuments && userData.identityDocuments.length > 0 && (
                    <Button
                      type="button"
                      onClick={handleSubmitDocuments}
                      className="flex items-center gap-2 bg-primary hover:bg-primary/90"
                    >
                      <Send className="h-4 w-4" />
                      Envoyer
                    </Button>
                  )}
                </div>
              </div>

              {/* Liste des documents téléchargés */}
              {userData.identityDocuments && userData.identityDocuments.length > 0 ? (
                <div className="space-y-2">
                  {userData.identityDocuments.map((doc, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-gray-500" />
                        <div>
                          <span className="text-sm block">{doc.name}</span>
                          <span className="text-xs text-gray-500">
                            {editedData.personal.nationality === 'Français' 
                              ? 'Document d\'identité'
                              : 'Titre de séjour'}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteDocument(doc.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">
                    {editedData.personal.nationality === 'Français'
                      ? 'Aucun document d\'identité téléchargé'
                      : 'Aucun titre de séjour téléchargé'}
                  </p>
                </div>
              )}
            </div>
          </PersonalInformation>
        </CardContent>
      </Card>
    </div>
  );
};

// Skeleton component for loading state
const ProfileSettingsSkeleton = () => {
  return (
    <div className="space-y-4 sm:space-y-6 w-full">
      {/* Profile Picture Card Skeleton */}
      <div className="bg-white rounded-lg shadow overflow-hidden w-full">
        {/* Card Header */}
        <div className="px-4 sm:px-6 md:px-8 py-4 sm:py-5 border-b">
          <Skeleton className="h-5 sm:h-6 w-36 sm:w-48 mb-2" />
          <Skeleton className="h-3 sm:h-4 w-48 sm:w-64" />
        </div>
        {/* Card Content */}
        <div className="px-4 sm:px-6 md:px-8 py-4 sm:py-6">
          <div className="flex flex-col xs:flex-row items-center justify-center">
            <div className="relative">
              <Skeleton className="h-20 w-20 sm:h-24 sm:w-24 md:h-32 md:w-32 rounded-full" />
              <Skeleton className="absolute bottom-0 right-0 w-6 sm:w-8 h-6 sm:h-8 rounded-full" />
            </div>
            <div className="mt-3 xs:mt-0 xs:ml-3">
              <Skeleton className="h-4 sm:h-5 w-32 mb-2" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <div className="mt-4 flex justify-center">
            <Skeleton className="h-8 sm:h-9 w-24 sm:w-28" />
          </div>
        </div>
      </div>
      
      {/* Personal Information Card Skeleton */}
      <div className="bg-white rounded-lg shadow overflow-hidden w-full">
        {/* Card Header */}
        <div className="px-4 sm:px-6 md:px-8 py-4 sm:py-5 border-b">
          <Skeleton className="h-5 sm:h-6 w-48 sm:w-64 mb-2" />
          <Skeleton className="h-3 sm:h-4 w-56 sm:w-80" />
        </div>
        {/* Card Content */}
        <div className="px-4 sm:px-6 md:px-8 py-4 sm:py-6">
          {/* Form Fields */}
          <div className="space-y-4 sm:space-y-6">
            {/* First Row - Name Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-2">
                <Skeleton className="h-4 sm:h-5 w-24 sm:w-32" />
                <Skeleton className="h-9 sm:h-10 w-full" />
              </div>
              
              <div className="space-y-2">
                <Skeleton className="h-4 sm:h-5 w-24 sm:w-32" />
                <Skeleton className="h-9 sm:h-10 w-full" />
              </div>
            </div>
            
            {/* Second Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-2">
                <Skeleton className="h-4 sm:h-5 w-24 sm:w-32" />
                <Skeleton className="h-9 sm:h-10 w-full" />
              </div>
              
              <div className="space-y-2">
                <Skeleton className="h-4 sm:h-5 w-24 sm:w-32" />
                <Skeleton className="h-9 sm:h-10 w-full" />
              </div>
            </div>
            
            {/* Full Width Fields */}
            <div className="space-y-2">
              <Skeleton className="h-4 sm:h-5 w-24 sm:w-32" />
              <Skeleton className="h-9 sm:h-10 w-full" />
            </div>
            
            {/* Address Section */}
            <div className="pt-3 sm:pt-4">
              <Skeleton className="h-5 sm:h-6 w-24 sm:w-32 mb-3 sm:mb-4" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                <Skeleton className="h-9 sm:h-10 w-full" />
                <Skeleton className="h-9 sm:h-10 w-full" />
              </div>
            </div>
            
            {/* Button */}
            <div className="flex justify-end mt-4 sm:mt-6">
              <Skeleton className="h-9 sm:h-10 w-32 sm:w-48" />
            </div>
          </div>
        </div>
      </div>
      
      {/* Additional Settings Card */}
      <div className="bg-white rounded-lg shadow overflow-hidden w-full">
        {/* Card Header */}
        <div className="px-4 sm:px-6 md:px-8 py-4 sm:py-5 border-b">
          <Skeleton className="h-5 sm:h-6 w-36 sm:w-48 mb-2" />
          <Skeleton className="h-3 sm:h-4 w-48 sm:w-64" />
        </div>
        {/* Card Content */}
        <div className="px-4 sm:px-6 md:px-8 py-4 sm:py-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            <Skeleton className="h-9 sm:h-10 w-full" />
            <Skeleton className="h-9 sm:h-10 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfileSettings; 