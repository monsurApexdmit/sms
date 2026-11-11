import { CalendarDaysIcon, ChevronRightIcon, EyeIcon, ChevronsUpDownIcon, GraduationCapIcon, LogOutIcon, UserIcon } from "lucide-react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useGet, usePublicSettings } from "../api/hooks";
import { useAuth } from "../auth/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { NotificationBell } from "../components/NotificationBell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Separator } from "../components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "../components/ui/sidebar";
import { usePageLevel } from "../hooks/use-access";
import { NAV, navFor } from "../nav";
import { initials, titleCase } from "../utils";
import { t, tn } from "../i18n";

export function AppLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const settings = usePublicSettings();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const here = NAV.find((n) => location.pathname === `/app/${n.path}` || location.pathname.startsWith(`/app/${n.path}/`));

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="bg-canvas">
        <header className="bg-background/85 sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b px-4 backdrop-blur-md md:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-5" />
          <nav aria-label={t("Breadcrumb")} className="flex min-w-0 items-center gap-1.5 text-sm">
            {here ? (
              <>
                {here.group && <span className="text-muted-foreground hidden truncate sm:inline">{here.group}</span>}
                {here.group && <ChevronRightIcon className="text-muted-foreground/60 hidden size-3.5 shrink-0 sm:block" />}
                <span className="truncate font-semibold">{here.label}</span>
              </>
            ) : (
              <span className="truncate font-semibold">{settings.data?.system_title || settings.data?.system_name}</span>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {settings.data?.running_year && (
              <span className="bg-accent text-accent-foreground hidden items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold md:inline-flex">
                <CalendarDaysIcon className="size-3.5" />
                {tn("Session {running_year}", { running_year: settings.data.running_year })}
              </span>
            )}
            <LanguageSwitcher compact />
            <NotificationBell />
            <Separator orientation="vertical" className="mx-1 hidden data-[orientation=vertical]:h-6 sm:block" />
            <TopbarUser />
          </div>
        </header>
        <ViewOnlyNotice />
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ViewOnlyNotice() {
  const level = usePageLevel();
  if (level !== "view") return null;
  return (
    <div className="no-print flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 md:px-8">
      <EyeIcon className="size-4 shrink-0" />
      {t("View only: your role can see this section but not change it.")}
    </div>
  );
}

// Dark sidebar: gold bar and icon on the active page, softer icons elsewhere.
const NAV_BUTTON =
  "relative h-9 text-sidebar-foreground/80 [&>svg]:opacity-75 hover:text-white hover:[&>svg]:opacity-100 data-[active=true]:bg-white/[0.09] data-[active=true]:font-semibold data-[active=true]:text-white data-[active=true]:[&>svg]:text-sidebar-primary data-[active=true]:[&>svg]:opacity-100 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-sidebar-primary before:opacity-0 data-[active=true]:before:opacity-100 group-data-[collapsible=icon]:before:hidden";

function UserMenuItems() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <>
      <DropdownMenuLabel className="font-normal">
        <div className="text-sm font-medium">{user.name}</div>
        <div className="text-muted-foreground text-xs">{titleCase(user.role)}</div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link to="/app/profile">
          <UserIcon />
          {t("My profile")}</Link>
      </DropdownMenuItem>
      <DropdownMenuItem
        variant="destructive"
        onClick={async () => {
          await logout();
          navigate("/login");
        }}
      >
        <LogOutIcon />
        {t("Log out")}</DropdownMenuItem>
    </>
  );
}

function TopbarUser() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="hover:bg-muted flex items-center gap-2 rounded-full p-0.5 pr-1 transition-colors sm:pr-2" aria-label={t("Account menu")}>
          <Avatar className="ring-primary/20 size-8 ring-2">
            <AvatarImage src={user.image_url ?? undefined} alt="" />
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm font-medium lg:inline">{user.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <UserMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppSidebar() {
  const { user } = useAuth();
  const location = useLocation();
  const settings = usePublicSettings();
  const unread = useGet<{ unread: number }>(user ? "/messages/unread-count" : null);
  const { isMobile, setOpenMobile } = useSidebar();
  if (!user) return null;

  const items = navFor(user.role, user.permissions);
  const groups = [...new Set(items.map((i) => i.group ?? ""))];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="hover:bg-transparent active:bg-transparent">
              <Link to="/app/dashboard">
                <div className="text-sidebar-primary-foreground flex aspect-square size-9 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[oklch(0.88_0.13_88)] to-[oklch(0.74_0.15_70)] shadow-md shadow-black/20">
                  {settings.data?.logo_url ? (
                    <img src={settings.data.logo_url} alt="" className="size-full bg-white object-contain p-0.5" />
                  ) : (
                    <GraduationCapIcon className="size-5" />
                  )}
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-[15px] font-bold tracking-tight text-white">{settings.data?.system_name || t("School")}</span>
                  <span className="text-sidebar-foreground/55 truncate text-xs">{tn("{titleCase} portal", { titleCase: titleCase(user.role) })}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <div className="bg-sidebar-border mx-3 h-px group-data-[collapsible=icon]:mx-2" />

      <SidebarContent className="py-2">
        {groups.map((group) => (
          <SidebarGroup key={group || "main"}>
            {group && <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10.5px] font-semibold tracking-[0.14em] uppercase">{group}</SidebarGroupLabel>}
            <SidebarMenu>
              {items
                .filter((i) => (i.group ?? "") === group)
                .map((item) => {
                  const to = item.path.startsWith("/") ? item.path : `/app/${item.path}`;
                  const active = location.pathname === to || location.pathname.startsWith(`${to}/`);
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label} className={NAV_BUTTON}>
                        <Link to={to} onClick={() => isMobile && setOpenMobile(false)}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.path === "messages" && !!unread.data?.unread && (
                        <SidebarMenuBadge className="bg-destructive rounded-full text-white">{unread.data.unread}</SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <Avatar className="ring-sidebar-primary/40 size-8 rounded-lg ring-1">
                    <AvatarImage src={user.image_url ?? undefined} alt="" />
                    <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground rounded-lg text-xs font-semibold">{initials(user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium text-white">{user.name}</span>
                    <span className="text-sidebar-foreground/55 truncate text-xs">{user.email}</span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" className="w-56">
                <UserMenuItems />
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
