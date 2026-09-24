import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { initials, navigate, plural, useApi, useLocation, type Me } from "./lib";
import { Icon } from "./ui/icons";
import { Toasts } from "./ui/kit";
import { Dashboard } from "./pages/Dashboard";
import { CalendarPage } from "./pages/Calendar";
import { GoalsPage } from "./pages/Goals";
import { HabitsPage } from "./pages/Habits";
import { TasksPage } from "./pages/Tasks";
import { WallPage } from "./pages/Wall";
import { MoneyPage } from "./pages/Money";
import { WishlistPage } from "./pages/Wishlist";
import { StatsPage } from "./pages/Stats";
import { ExtensionPage } from "./pages/Extension";
import { SettingsPage } from "./pages/Settings";
import { LoginPage } from "./pages/Login";

type MeFull = Me & { today: string; done: number; total: number; passUsed: boolean; streak: { current: number; best: number } };

const MeCtx = createContext<MeFull | null>(null);
export const useMe = () => useContext(MeCtx);

const NAV: { section: string; items: { path: string; label: string; icon: string }[] }[] = [
  {
    section: "Основное",
    items: [
      { path: "/", label: "Сегодня", icon: "today" },
      { path: "/calendar", label: "Календарь", icon: "calendar" },
      { path: "/goals", label: "Цели", icon: "target" },
      { path: "/habits", label: "Привычки", icon: "repeat" },
      { path: "/tasks", label: "Задачи", icon: "tasks" },
    ],
  },
  {
    section: "Жизнь",
    items: [
      { path: "/wall", label: "Стена", icon: "wall" },
      { path: "/money", label: "Деньги", icon: "wallet" },
      { path: "/wishlist", label: "Вишлист", icon: "gift" },
    ],
  },
  {
    section: "Инструменты",
    items: [
      { path: "/stats", label: "Статистика", icon: "chart" },
      { path: "/extension", label: "Расширение", icon: "puzzle" },
    ],
  },
];

const PAGES: Record<string, () => ReactNode> = {
  "/": () => <Dashboard />,
  "/calendar": () => <CalendarPage />,
  "/goals": () => <GoalsPage />,
  "/habits": () => <HabitsPage />,
  "/tasks": () => <TasksPage />,
  "/wall": () => <WallPage />,
  "/money": () => <MoneyPage />,
  "/wishlist": () => <WishlistPage />,
  "/stats": () => <StatsPage />,
  "/extension": () => <ExtensionPage />,
  "/settings": () => <SettingsPage />,
};

export function App() {
  const path = useLocation();
  if (path === "/login") {
    return (
      <>
        <LoginPage />
        <Toasts />
      </>
    );
  }
  return <Shell path={path} />;
}

function Shell({ path }: { path: string }) {
  const me = useApi<MeFull>("/me");
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const page = PAGES[path] ?? PAGES["/"];
  const left = me.data ? me.data.total - me.data.done : 0;

  const NavItem = ({ p, label, icon, badge }: { p: string; label: string; icon: string; badge?: ReactNode }) => (
    <a
      href={p}
      className={`nav-item${path === p ? " active" : ""}`}
      onClick={(e) => {
        e.preventDefault();
        navigate(p);
      }}
    >
      <Icon name={icon} size={21} />
      {label}
      {badge}
    </a>
  );

  return (
    <MeCtx.Provider value={me.data}>
      <div className="app">
        <aside className={`sidebar${open ? " open" : ""}`}>
          <a
            href="/"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            <span className="brand-mark">L</span>
            <span>
              Life<b>Helper</b>
            </span>
          </a>
          {NAV.map((s) => (
            <div key={s.section}>
              <div className="nav-section">{s.section}</div>
              {s.items.map((it) => (
                <NavItem
                  key={it.path}
                  p={it.path}
                  label={it.label}
                  icon={it.icon}
                  badge={it.path === "/" && me.data && left > 0 && !me.data.passUsed ? <span className="nav-badge">{left}</span> : undefined}
                />
              ))}
            </div>
          ))}
          <div className="nav-bottom">
            <NavItem p="/settings" label="Настройки" icon="settings" />
          </div>
        </aside>
        {open && <div className="scrim" onClick={() => setOpen(false)} />}
        <main className="main">
          <BurgerCtx.Provider value={() => setOpen(true)}>{page()}</BurgerCtx.Provider>
        </main>
      </div>
      <Toasts />
    </MeCtx.Provider>
  );
}

const BurgerCtx = createContext<() => void>(() => undefined);

/** Шапка страницы + контент */
export function Page({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const me = useMe();
  const openMenu = useContext(BurgerCtx);
  useEffect(() => {
    if (typeof title === "string") document.title = `${title} · LifeHelper`;
  }, [title]);
  return (
    <>
      <header className="topbar">
        <button className="btn ghost icon burger" onClick={openMenu} aria-label="Меню">
          <Icon name="menu" />
        </button>
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <div className="spacer" />
        {actions}
        {me && (
          <div className="user-chip" title={`Стрик ${me.streak.current}, рекорд ${me.streak.best}`}>
            <div className="avatar">{initials(me.name)}</div>
            <div className="who">
              <div className="name">{me.name}</div>
              <div className="role">
                🔥 {me.streak.current} {plural(me.streak.current, "день", "дня", "дней")}
              </div>
            </div>
          </div>
        )}
      </header>
      <div className="content">{children}</div>
    </>
  );
}
