import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiService from './apiService';

// Query keys
export const CHAT_KEYS = {
  all: ['chat'],
  global: () => [...CHAT_KEYS.all, 'global'],
  private: (userId) => [...CHAT_KEYS.all, 'private', userId],
};

// Function to clear all chat cache (both localStorage and React Query)
export const clearChatCache = (queryClient) => {
  // Clear localStorage chat items
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('global_chat_messages') || key.startsWith('private_chat_messages_'))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
  
  // Clear React Query cache if queryClient is provided
  if (queryClient) {
    queryClient.removeQueries({ queryKey: CHAT_KEYS.all });
  }
};

// Local storage functions
const saveToStorage = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error(`Error saving to storage with key ${key}:`, err);
  }
};

const loadFromStorage = (key) => {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`Error loading from storage with key ${key}:`, err);
    return null;
  }
};

// Create mock messages for when API is unavailable
const createMockMessages = () => {
  const now = new Date();
  return [
    {
      id: 'mock-1',
      content: "Welcome to the messaging system!",
      createdAt: new Date(now.getTime() - 86400000).toISOString(), // 1 day ago
      sender: {
        id: 'system',
        firstName: 'System',
        lastName: 'Notification',
      },
      isSystem: true
    },
    {
      id: 'mock-2',
      content: "This is a placeholder message while the messaging API is being connected.",
      createdAt: new Date(now.getTime() - 3600000).toISOString(), // 1 hour ago
      sender: {
        id: 'system',
        firstName: 'System',
        lastName: 'Notification',
      },
      isSystem: true
    }
  ];
};

// Create mock private messages for a specific user
const createMockPrivateMessages = (userId) => {
  const now = new Date();
  return [
    {
      id: `private-mock-${userId}-1`,
      content: "Welcome to your private conversation!",
      createdAt: new Date(now.getTime() - 86400000).toISOString(), // 1 day ago
      sender: {
        id: 'system',
        firstName: 'System',
        lastName: 'Notification',
      },
      recipientId: userId,
      isSystem: true
    }
  ];
};

// Global chat hooks
export const useGlobalMessages = () => {
  const queryClient = useQueryClient();
  
  // Query for fetching global messages
  const messagesQuery = useQuery({
    queryKey: CHAT_KEYS.global(),
    queryFn: async () => {
      // First try to load from localStorage
      const storedMessages = loadFromStorage('global_chat_messages');
      
      // Check if we're in the login flow by looking for a special flag
      const isLoginProcess = sessionStorage.getItem('login_in_progress') === 'true';
      if (isLoginProcess) {
        console.info('Login in progress, skipping messages API call');
        return storedMessages || createMockMessages();
      }
      
      try {
        // Fetch from API with enhanced error handling
        const response = await apiService.get('/messages/recent', {
          ...apiService.withAuth(),
          timeout: 8000,   // Augmenter le timeout à 8 secondes
          retries: 2,      // Permettre 2 tentatives
          noCache: false   // Permettre l'utilisation du cache
        });
        
        // Add fallback for missing or malformed response
        if (!response || response.success === false) {
          console.warn('API returned invalid messages response, using local cache');
          return storedMessages || createMockMessages();
        }
        
        const serverMessages = response.messages || [];
        
        // Merge with stored messages if available, giving preference to local
        if (storedMessages?.length > 0) {
          const combinedMessages = mergeChatMessages(storedMessages, serverMessages);
          saveToStorage('global_chat_messages', combinedMessages);
          return combinedMessages;
        }
        
        // If no stored messages, just use server messages
        saveToStorage('global_chat_messages', serverMessages);
        return serverMessages;
      } catch (err) {
        console.error('Failed to fetch global messages:', err);
        
        if (err.code === 'ECONNABORTED') {
          // Inform in logs that we're using cached messages due to timeout
          console.warn('API timeout, using cached messages');
        }
        
        // Return stored messages as fallback if available, otherwise use mock data
        return storedMessages || createMockMessages();
      }
    },
    initialData: () => loadFromStorage('global_chat_messages') || createMockMessages(),
    staleTime: 60000, // Augmenter à 60 secondes pour réduire les requêtes fréquentes
    retry: 1,         // Limiter à 1 tentative de la requête entière
    retryDelay: 1000, // Attendre 1 seconde avant de réessayer
  });
  
  // Mutation for sending a message
  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, tempId }) => {
      const response = await apiService.post('/messages', { content }, apiService.withAuth());
      return { 
        serverMessage: response.data,
        tempId
      };
    },
    onMutate: async ({ content, user, tempId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: CHAT_KEYS.global() });
      
      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData(CHAT_KEYS.global());
      
      // Optimistically update to the new value
      const tempMessage = {
        id: tempId,
        content,
        sender: user,
        createdAt: new Date().toISOString(),
        isSending: true,
        permanent: true
      };
      
      const newMessages = [...previousMessages, tempMessage];
      queryClient.setQueryData(CHAT_KEYS.global(), newMessages);
      saveToStorage('global_chat_messages', newMessages);
      
      // Return a context object with the snapshotted value
      return { previousMessages, tempMessage };
    },
    onSuccess: (data, variables, context) => {
      const { serverMessage, tempId } = data;
      const currentMessages = queryClient.getQueryData(CHAT_KEYS.global());
      
      // Update the temp message with the server message
      const updatedMessages = currentMessages.map(msg => 
        msg.id === tempId
          ? { 
              ...serverMessage, 
              confirmed: true,
              permanent: true,
              sender: serverMessage.sender || context.tempMessage.sender
            }
          : msg
      );
      
      queryClient.setQueryData(CHAT_KEYS.global(), updatedMessages);
      saveToStorage('global_chat_messages', updatedMessages);
    },
    onError: (error, variables, context) => {
      console.error('Error sending message:', error);
      
      // Revert to the previous value if the mutation fails
      if (context?.previousMessages) {
        const currentMessages = queryClient.getQueryData(CHAT_KEYS.global());
        
        // Mark the message as failed but keep it
        const updatedMessages = currentMessages.map(msg => 
          msg.id === context.tempMessage.id
            ? { ...msg, isSending: false, sendFailed: true, permanent: true }
            : msg
        );
        
        queryClient.setQueryData(CHAT_KEYS.global(), updatedMessages);
        saveToStorage('global_chat_messages', updatedMessages);
      }
    }
  });
  
  return {
    messages: messagesQuery.data || [],
    isLoading: messagesQuery.isLoading,
    error: messagesQuery.error,
    refetch: messagesQuery.refetch,
    sendMessage: sendMessageMutation.mutate,
    isSending: sendMessageMutation.isPending,
  };
};

// Private chat hooks
export const usePrivateMessages = (userId) => {
  const queryClient = useQueryClient();
  const storageKey = `private_chat_messages_${userId}`;
  
  // Query for fetching private messages
  const messagesQuery = useQuery({
    queryKey: CHAT_KEYS.private(userId),
    queryFn: async () => {
      // First try to load from localStorage
      const storedMessages = loadFromStorage(storageKey);
      
      // Check if we're in the login flow by looking for a special flag
      const isLoginProcess = sessionStorage.getItem('login_in_progress') === 'true';
      if (isLoginProcess) {
        console.info('Login in progress, skipping private messages API call');
        return storedMessages || createMockPrivateMessages(userId);
      }
      
      try {
        // Fetch from API with enhanced error handling
        const response = await apiService.get(`/messages/private/${userId}`, {
          ...apiService.withAuth(),
          timeout: 8000,  // Augmenter le timeout à 8 secondes
          retries: 2,     // Permettre 2 tentatives
          noCache: false  // Permettre l'utilisation du cache
        });
        
        // Add fallback for missing or malformed response
        if (!response || response.success === false) {
          console.warn('API returned invalid private messages response, using local cache');
          return storedMessages || createMockPrivateMessages(userId);
        }
        
        const serverMessages = response.messages || [];
        
        // Merge with stored messages if available, giving preference to local
        if (storedMessages?.length > 0) {
          const combinedMessages = mergeChatMessages(storedMessages, serverMessages);
          saveToStorage(storageKey, combinedMessages);
          return combinedMessages;
        }
        
        // If no stored messages, just use server messages
        saveToStorage(storageKey, serverMessages);
        return serverMessages;
      } catch (err) {
        console.error(`Failed to fetch private messages for user ${userId}:`, err);
        
        if (err.code === 'ECONNABORTED') {
          // Inform in logs that we're using cached messages due to timeout
          console.warn('API timeout, using cached private messages');
        }
        
        // Return stored messages as fallback if available, otherwise use mock data
        return storedMessages || createMockPrivateMessages(userId);
      }
    },
    initialData: () => loadFromStorage(storageKey) || createMockPrivateMessages(userId),
    enabled: !!userId, // Only run query if userId is provided
    staleTime: 60000, // Augmenter à 60 secondes pour réduire les requêtes fréquentes
    retry: 1,         // Limiter à 1 tentative de la requête entière
    retryDelay: 1000, // Attendre 1 seconde avant de réessayer
  });
  
  // Mutation for sending a private message
  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, recipientId, tempId }) => {
      const response = await apiService.post('/messages/private', 
        { content, recipientId }, 
        apiService.withAuth()
      );
      return { 
        serverMessage: response.data,
        tempId
      };
    },
    onMutate: async ({ content, user, recipientId, tempId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: CHAT_KEYS.private(recipientId) });
      
      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData(CHAT_KEYS.private(recipientId));
      
      // Optimistically update to the new value
      const tempMessage = {
        id: tempId,
        content,
        sender: user,
        recipientId,
        createdAt: new Date().toISOString(),
        isSending: true,
        permanent: true
      };
      
      const newMessages = [...previousMessages, tempMessage];
      queryClient.setQueryData(CHAT_KEYS.private(recipientId), newMessages);
      saveToStorage(storageKey, newMessages);
      
      // Return a context object with the snapshotted value
      return { previousMessages, tempMessage };
    },
    onSuccess: (data, variables, context) => {
      const { serverMessage, tempId } = data;
      const currentMessages = queryClient.getQueryData(CHAT_KEYS.private(variables.recipientId));
      
      // Update the temp message with the server message
      const updatedMessages = currentMessages.map(msg => 
        msg.id === tempId
          ? { 
              ...serverMessage, 
              confirmed: true,
              permanent: true,
              sender: serverMessage.sender || context.tempMessage.sender
            }
          : msg
      );
      
      queryClient.setQueryData(CHAT_KEYS.private(variables.recipientId), updatedMessages);
      saveToStorage(storageKey, updatedMessages);
    },
    onError: (error, variables, context) => {
      console.error('Error sending private message:', error);
      
      // Revert to the previous value if the mutation fails
      if (context?.previousMessages) {
        const currentMessages = queryClient.getQueryData(CHAT_KEYS.private(variables.recipientId));
        
        // Mark the message as failed but keep it
        const updatedMessages = currentMessages.map(msg => 
          msg.id === context.tempMessage.id
            ? { ...msg, isSending: false, sendFailed: true, permanent: true }
            : msg
        );
        
        queryClient.setQueryData(CHAT_KEYS.private(variables.recipientId), updatedMessages);
        saveToStorage(storageKey, updatedMessages);
      }
    }
  });
  
  return {
    messages: messagesQuery.data || [],
    isLoading: messagesQuery.isLoading,
    error: messagesQuery.error,
    refetch: messagesQuery.refetch,
    sendMessage: sendMessageMutation.mutate,
    isSending: sendMessageMutation.isPending,
  };
};

// Helper function to merge messages from different sources
function mergeChatMessages(localMessages, serverMessages) {
  // Start with a copy of local messages
  const result = [...localMessages];
  
  // Add server messages that aren't already in local messages
  serverMessages.forEach(serverMsg => {
    const existsLocally = result.some(localMsg => 
      // Check by ID first
      (serverMsg.id && localMsg.id && serverMsg.id === localMsg.id) ||
      // Then try content + sender match
      (serverMsg.content === localMsg.content && 
        serverMsg.sender?.id === localMsg.sender?.id)
    );
    
    if (!existsLocally) {
      result.push(serverMsg);
    }
  });
  
  // Sort by creation time
  return result.sort((a, b) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

export default {
  useGlobalMessages,
  usePrivateMessages,
  clearChatCache,
  CHAT_KEYS
}; 