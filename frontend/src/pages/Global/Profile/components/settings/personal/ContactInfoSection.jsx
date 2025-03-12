import React from 'react';
import { Mail, Phone, MapPin } from 'lucide-react';
import EditableField from '../personal/EditableField';
import { StaticField } from './StaticField';
import { AddressField } from './AddressField';
import { formatAddress } from './utils';

export const ContactInfoSection = ({ 
  userData, 
  editedData, 
  editMode, 
  setEditedData,
  isFieldEditable, 
  toggleFieldEdit, 
  handleCancelField, 
  handleInputChange, 
  onSave,
  onSaveAddress,
  setEditMode
}) => {
  // Get the handleCancelAddress function from the hook
  const handleCancelAddress = () => {
    const address = userData.addresses && userData.addresses.length > 0 
      ? userData.addresses[0] 
      : null;

    setEditedData(prev => ({
      ...prev,
      address: address ? {
        name: address.name || '',
        complement: address.complement || '',
        postalCode: { code: address.postalCode?.code || '' },
        city: { name: address.city?.name || '' }
      } : {
        name: '',
        complement: '',
        postalCode: { code: '' },
        city: { name: '' }
      }
    }));
    setEditMode(prev => ({
      ...prev,
      address: false
    }));
  };

  // Check if user is admin
  const isAdmin = React.useMemo(() => {
    const adminRoles = ['ROLE_ADMIN', 'ROLE_SUPER_ADMIN', 'ADMIN', 'SUPER_ADMIN', 'SUPERADMIN'];
    return adminRoles.includes(userData?.role);
  }, [userData?.role]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
      <div className="sm:col-span-2">
        {isFieldEditable('email') ? (
          <EditableField
            field="email"
            label="Email"
            icon={<Mail className="h-4 w-4 mr-2 text-gray-500" />}
            value={userData.email}
            editedValue={editedData.personal.email}
            type="email"
            isEditing={editMode.email}
            isEditable={true}
            onEdit={() => toggleFieldEdit('email')}
            onSave={onSave}
            onCancel={() => handleCancelField('email')}
            onChange={(value) => handleInputChange('email', value)}
          />
        ) : (
          <StaticField 
            label="Email"
            icon={<Mail className="h-4 w-4 mr-2 text-gray-500" />}
            value={userData.email || 'Non renseigné'}
          />
        )}
      </div>

      {isFieldEditable('phoneNumber') ? (
        <EditableField
          field="phoneNumber"
          label="Téléphone"
          icon={<Phone className="h-4 w-4 mr-2 text-gray-500" />}
          value={userData.phoneNumber}
          editedValue={editedData.personal.phoneNumber}
          type="phone"
          isEditing={editMode.phoneNumber}
          isEditable={true}
          onEdit={() => toggleFieldEdit('phoneNumber')}
          onSave={onSave}
          onCancel={() => handleCancelField('phoneNumber')}
          onChange={(value) => handleInputChange('phoneNumber', value)}
        />
      ) : (
        <StaticField 
          label="Téléphone"
          icon={<Phone className="h-4 w-4 mr-2 text-gray-500" />}
          value={userData.phoneNumber || 'Non renseigné'}
        />
      )}

      {isFieldEditable('address') ? (
        <AddressField 
          userData={userData}
          editedData={editedData}
          editMode={editMode}
          setEditMode={setEditMode}
          setEditedData={setEditedData}
          onSaveAddress={onSaveAddress}
          isAdmin={isAdmin}
          handleCancelAddress={handleCancelAddress}
        />
      ) : (
        <StaticField 
          label="Adresse"
          icon={<MapPin className="h-4 w-4 mr-2 text-blue-500 flex-shrink-0" />}
          value={userData.addresses && Array.isArray(userData.addresses) && userData.addresses.length > 0
            ? formatAddress(userData.addresses[0])
            : 'Aucune adresse renseignée'}
        />
      )}
    </div>
  );
}; 