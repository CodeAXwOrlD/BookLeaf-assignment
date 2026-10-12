import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import type { Role } from './types';
import { Loading } from './ui/Marks';
import { AdminLayout } from './pages/admin/AdminLayout';
import { Queue } from './pages/admin/Queue';
import { TicketDetail } from './pages/admin/TicketDetail';
import { AuthorLayout } from './pages/author/AuthorLayout';
import { Books } from './pages/author/Books';
import { MyTickets } from './pages/author/MyTickets';
import { NewTicket } from './pages/author/NewTicket';
import { Login } from './pages/Login';

function Guard({ role, children }: { role: Role; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Opening your desk" />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/books'} replace />;
  return <>{children}</>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/books'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route element={<Guard role="author"><AuthorLayout /></Guard>}>
        <Route path="/books" element={<Books />} />
        <Route path="/query/new" element={<NewTicket />} />
        <Route path="/tickets" element={<MyTickets />} />
        <Route path="/tickets/:id" element={<MyTickets />} />
      </Route>
      <Route element={<Guard role="admin"><AdminLayout /></Guard>}>
        <Route path="/admin" element={<Queue />} />
        <Route path="/admin/tickets/:id" element={<TicketDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
