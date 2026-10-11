import axios from 'axios';

const apiClient = axios.create({
    baseURL: 'http://localhost:8080/api',
});

export const fetchZombieInstances = () => apiClient.get('/zombies');
export const fetchSummary = () => apiClient.get('/summary');
export const terminateInstance = (instanceId) => apiClient.post(`/terminate/${instanceId}`);
export const terminateAllZombies = () => apiClient.post('/terminate-all');
export const refreshFleet = () => apiClient.post('/refresh');
export const fetchHistory = () => apiClient.get('/history');