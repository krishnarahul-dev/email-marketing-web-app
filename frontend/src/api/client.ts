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
  reorderSteps: (id: string, stepIds: string[]) => api.post(`/sequences/${id}/steps/reorder`, { stepIds }),
  enroll: (id: string, contactIds: string[]) => api.post(`/sequences/${id}/enroll`, { contactIds }),
  bulkEnroll: (id: string, contactIds: string[]) => api.post(`/sequences/${id}/enroll`, { contactIds }),
  cancelEnrollment: (id: string, enrollmentId: string) => api.post(`/sequences/${id}/enrollments/${enrollmentId}/cancel`),
  pauseEnrollment: (id: string, enrollmentId: string) => api.post(`/sequences/${id}/enrollments/${enrollmentId}/pause`),
  resumeEnrollment: (id: string, enrollmentId: string) => api.post(`/sequences/${id}/enrollments/${enrollmentId}/resume`),
  listEnrollments: (id: string, params?: Record<string, any>) => api.get(`/sequences/${id}/enrollments`, { params }),
  // New endpoints for sequence detail page
  contacts: (id: string, params?: Record<string, any>) => api.get(`/sequences/${id}/contacts`, { params }),
  contactStatusCounts: (id: string) => api.get(`/sequences/${id}/contacts/counts`),
  emails: (id: string, params?: Record<string, any>) => api.get(`/sequences/${id}/emails`, { params }),
  emailStatusCounts: (id: string) => api.get(`/sequences/${id}/emails/counts`),
  activity: (id: string, params?: Record<string, any>) => api.get(`/sequences/${id}/activity`, { params }),
  report: (id: string) => api.get(`/sequences/${id}/report`),
  duplicate: (id: string, name?: string) => api.post(`/sequences/${id}/duplicate`, { name }),
  toggleActive: (id: string, active: boolean) => api.put(`/sequences/${id}`, { status: active ? 'active' : 'paused' }),
};

// Schedules (per-weekday send windows)
export const schedulesApi = {
  list: () => api.get('/schedules'),
  get: (id: string) => api.get(`/schedules/${id}`),
  create: (data: any) => api.post('/schedules', data),
  update: (id: string, data: any) => api.put(`/schedules/${id}`, data),
  delete: (id: string) => api.delete(`/schedules/${id}`),
  setDefault: (id: string) => api.post(`/schedules/${id}/set-default`),
};

// Mailboxes (per-workspace verified senders + AWS credentials)
export const mailboxesApi = {
  // AWS credentials
  getAwsSettings: () => api.get('/mailboxes/aws-settings'),
  saveAwsSettings: (data: { access_key_id: string; secret_access_key: string; region?: string }) =>
    api.post('/mailboxes/aws-settings', data),
  refreshQuota: () => api.post('/mailboxes/aws-settings/refresh-quota'),
  deleteAwsSettings: () => api.delete('/mailboxes/aws-settings'),
  // Mailboxes
  list: () => api.get('/mailboxes'),
  get: (id: string) => api.get(`/mailboxes/${id}`),
  create: (data: any) => api.post('/mailboxes', data),
  update: (id: string, data: any) => api.put(`/mailboxes/${id}`, data),
  delete: (id: string) => api.delete(`/mailboxes/${id}`),
  setDefault: (id: string) => api.post(`/mailboxes/${id}/set-default`),
  checkVerification: (id: string) => api.post(`/mailboxes/${id}/check-verification`),
  resendVerification: (id: string) => api.post(`/mailboxes/${id}/resend-verification`),
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

// Tasks
export const tasksApi = {
  list: (params?: Record<string, any>) => api.get('/tasks', { params }),
  get: (id: string) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.put(`/tasks/${id}`, data),
  complete: (id: string, data: { outcome?: string; notes?: string }) => api.post(`/tasks/${id}/complete`, data),
  skip: (id: string, reason?: string) => api.post(`/tasks/${id}/skip`, { reason }),
  delete: (id: string) => api.delete(`/tasks/${id}`),
  summary: () => api.get('/tasks/stats/summary'),
};

// Snippets
export const snippetsApi = {
  list: (category?: string) => api.get('/snippets', { params: { category } }),
  get: (id: string) => api.get(`/snippets/${id}`),
  create: (data: any) => api.post('/snippets', data),
  update: (id: string, data: any) => api.put(`/snippets/${id}`, data),
  delete: (id: string) => api.delete(`/snippets/${id}`),
};

// Sequence templates library
export const sequenceTemplatesApi = {
  library: (category?: string) => api.get('/sequence-templates/library', { params: { category } }),
  get: (id: string) => api.get(`/sequence-templates/library/${id}`),
  instantiate: (id: string, name?: string) => api.post(`/sequence-templates/library/${id}/instantiate`, { name }),
  duplicateSequence: (id: string, name?: string) => api.post(`/sequence-templates/sequences/${id}/duplicate`, { name }),
};

// A/B variants
export const abVariantsApi = {
  listForStep: (stepId: string) => api.get(`/ab-variants/step/${stepId}`),
  create: (stepId: string, data: any) => api.post(`/ab-variants/step/${stepId}`, data),
  update: (variantId: string, data: any) => api.put(`/ab-variants/${variantId}`, data),
  declareWinner: (variantId: string) => api.post(`/ab-variants/${variantId}/declare-winner`),
  delete: (variantId: string) => api.delete(`/ab-variants/${variantId}`),
};

// Activity
export const activityApi = {
  list: (params?: Record<string, any>) => api.get('/activity', { params }),
  forContact: (contactId: string, limit?: number) => api.get(`/activity/contact/${contactId}`, { params: { limit } }),
};
