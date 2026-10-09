import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth';
import { LoginPage } from './LoginPage';

function renderLogin() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/login']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<p>Dashboard home</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('LoginPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('explains a wrong password', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(401, { message: 'Invalid email or password' })));
    renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('don’t match an active staff account');
  });

  it('signs in, stores the token for this tab and opens the dashboard', async () => {
    const fetchMock = vi.fn(() => json(200, { accessToken: 'tok', admin: { id: '1', name: 'Ann', email: 'a@b.co', role: 'MODERATOR' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
    expect(sessionStorage.getItem('ttp-admin-token')).toBe('tok');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/auth/login', expect.objectContaining({ method: 'POST' }));
  });
});
