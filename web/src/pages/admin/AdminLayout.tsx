import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth';
import { firstName } from '../../format';
import { useLive } from '../../live';
import { LiveDot } from '../../ui/Marks';
import { LeafMark } from '../../ui/Plates';
import { LiveContext } from '../liveContext';

export function AdminLayout() {
  const { user, logout } = useAuth();
  const bus = LiveContext.useListeners();
  const state = useLive(bus.emit);

  return (
    <LiveContext.Provider value={bus}>
      <div className="theme-press">
        <header className="topbar">
          <div className="topbar-inner topbar-wide">
            <NavLink to="/admin" className="brand">
              <LeafMark size={18} />
              <span>BookLeaf</span>
              <small>Support queue</small>
            </NavLink>
            <nav aria-label="Main"><NavLink to="/admin" end>Queue</NavLink></nav>
            <div className="topbar-user">
              <LiveDot state={state} />
              <span>{firstName(user!.name)}</span>
              <button className="linklike" onClick={logout}>Sign out</button>
            </div>
          </div>
        </header>
        <main className="page page-wide"><Outlet /></main>
      </div>
    </LiveContext.Provider>
  );
}
