import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  '';

const api: AxiosInstance = axios.create({
  baseURL: `${API_BASE}/api`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginPage = window.location.pathname === '/login';

    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');

      if (!isLoginPage) {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;

// Auth
export const authApi = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  register: (data: { email: string; password: string; name: string; workspaceName: string }) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
  updateWorkspace: (data: any) => api.put('/auth/workspace', data),
};

// Contacts
export const contactsApi = {
  list: (params?: Record<string, any>) => api.get('/contacts', { params }),
  get: (id: string) => api.get(`/contacts/${id}`),
  create: (data: any) => api.post('/contacts', data),
  update: (id: string, data: any) => api.put(`/contacts/${id}`, data),
  delete: (id: string) => api.delete(`/contacts/${id}`),
  import: (formData: FormData) => api.post('/contacts/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  bulkTag: (contactIds: string[], tags: string[]) => api.post('/contacts/bulk-tag', { contactIds, tags }),
  bulkDelete: (contactIds: string[]) => api.post('/contacts/bulk-delete', { contactIds }),
};

// Campaigns
export const campaignsApi = {
  list: (params?: Record<string, any>) => api.get('/campaigns', { params }),
  get: (id: string) => api.get(`/campaigns/${id}`),
  create: (data: any) => api.post('/campaigns', data),
  update: (id: string, data: any) => api.put(`/campaigns/${id}`, data),
  delete: (id: string) => api.delete(`/campaigns/${id}`),
  addRecipients: (id: string, data: any) => api.post(`/campaigns/${id}/recipients`, data),
  send: (id: string) => api.post(`/campaigns/${id}/send`),
  pause: (id: string) => api.post(`/campaigns/${id}/pause`),
  reset: (id: string) => api.post(`/campaigns/${id}/reset`),
  stats: (id: string) => api.get(`/campaigns/${id}/stats`),
};

// Sequences
export const sequencesApi = {
  list: (params?: Record<string, any>) => api.get('/sequences', { params }),
  get: (id: string) => api.get(`/sequences/${id}`),
  create: (data: any) => api.post('/sequences', data),
  update: (id: string, data: any) => api.put(`/sequences/${id}`, data),
  delete: (id: string) => api.delete(`/sequences/${id}`),
  addStep: (id: string, data: any) => api.post(`/sequences/${id}/steps`, data),
  updateStep: (id: string, stepId: string, data: any) => api.put(`/sequences/${id}/steps/${stepId}`, data),
  deleteStep: (id: string, stepId: string) => api.delete(`/sequences/${id}/steps/${stepId}`),
  enroll: (id: string, contactIds: string[]) => api.post(`/sequences/${id}/enroll`, { contactIds }),
  cancelEnrollment: (id: string, enrollmentId: string) => api.post(`/sequences/${id}/enrollments/${enrollmentId}/cancel`),
  listEnrollments: (id: string, params?: Record<string, any>) => api.get(`/sequences/${id}/enrollments`, { params }),
};

// Templates
export const templatesApi = {
  list: (params?: Record<string, any>) => api.get('/templates', { params }),
  get: (id: string) => api.get(`/templates/${id}`),
  create: (data: any) => api.post('/templates', data),
  update: (id: string, data: any) => api.put(`/templates/${id}`, data),
  delete: (id: string) => api.delete(`/templates/${id}`),
  spamCheck: (id: string) => api.post(`/templates/${id}/spam-check`),
  spamCheckBody: (data: { html_content: string; subject?: string }) => api.post('/templates/spam-check', data),
  versions: (id: string) => api.get(`/templates/${id}/versions`),
};

// Analytics
export const analyticsApi = {
  overview: () => api.get('/analytics/overview'),
  timeline: (days?: number) => api.get('/analytics/timeline', { params: { days } }),
  toneBreakdown: () => api.get('/analytics/tone-breakdown'),
  replies: (limit?: number) => api.get('/analytics/replies', { params: { limit } }),
};
