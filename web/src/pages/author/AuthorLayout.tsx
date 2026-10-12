import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth';
import { firstName } from '../../format';
import { useLive } from '../../live';
import { LiveDot } from '../../ui/Marks';
import { LeafMark } from '../../ui/Plates';
import { LiveContext } from '../liveContext';

export function AuthorLayout() {
  const { user, logout } = useAuth();
  const listeners = LiveContext.useListeners();
  const state = useLive(listeners.emit);

  return (
    <LiveContext.Provider value={listeners}>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/books" className="brand">
            <LeafMark size={18} />
            <span>BookLeaf</span>
            <small>Author desk</small>
          </NavLink>
          <nav aria-label="Main">
            <NavLink to="/books">Your books</NavLink>
            <NavLink to="/query/new">New query</NavLink>
            <NavLink to="/tickets">Your queries</NavLink>
          </nav>
          <div className="topbar-user">
            <LiveDot state={state} />
            <span>{firstName(user!.name)}</span>
            <button className="linklike" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </LiveContext.Provider>
  );
}
