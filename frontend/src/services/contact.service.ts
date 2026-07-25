import { apiClient } from "@/lib/api-client";
import { Contact, ContactCreate } from "@/types/contact.types";

export class ContactService {
  async getContacts(email: string): Promise<Contact[]> {
    return apiClient.request<Contact[]>(`/api/contacts/?email=${encodeURIComponent(email)}`);
  }

  async addContact(email: string, data: ContactCreate): Promise<Contact> {
    return apiClient.request<Contact>(`/api/contacts/?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateContact(email: string, id: number, data: Partial<ContactCreate>): Promise<Contact> {
    return apiClient.request<Contact>(`/api/contacts/${id}?email=${encodeURIComponent(email)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteContact(email: string, id: number): Promise<{ success: boolean; message: string }> {
    return apiClient.request<{ success: boolean; message: string }>(`/api/contacts/${id}?email=${encodeURIComponent(email)}`, {
      method: 'DELETE',
    });
  }

  async searchContacts(email: string, query: string): Promise<Contact[]> {
    return apiClient.request<Contact[]>(`/api/contacts/search?email=${encodeURIComponent(email)}&q=${encodeURIComponent(query)}`);
  }
}

export const contactService = new ContactService();
