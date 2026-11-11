import dayjs from "dayjs";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  ImageIcon,
  LogInIcon,
  MailIcon,
  MapPinIcon,
  MegaphoneIcon,
  MenuIcon,
  NewspaperIcon,
  PaperclipIcon,
  PhoneIcon,
  PrinterIcon,
  SearchIcon,
  SendIcon,
  UsersIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, Outlet, useLocation, useParams } from "react-router-dom";

import { api } from "../../api/client";
import { useAction, useGet, usePublicSettings } from "../../api/hooks";
import { EmptyState } from "../../components/states";
import { Field } from "../../components/field";
import { PAYMENT_METHODS } from "../../components/payment-methods";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "../../components/ui/navigation-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../../components/ui/sheet";
import { Skeleton } from "../../components/ui/skeleton";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/utils";
import { fromUnix, initials } from "../../utils";
import { PHOTO_ACCEPT, PHOTO_LABEL } from "../../components/admission-photo";
import { t as tr, tn } from "../../i18n";

interface Site {
  system_name: string;
  school_title: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  school_location: string | null;
  copyright_text: string | null;
  about_us: string | null;
  terms_conditions: string | null;
  privacy_policy: string | null;
  homepage_note_title: string | null;
  homepage_note_description: string | null;
  theme: string | null;
  social_links: Record<string, string>;
  header_logo_url: string | null;
  footer_logo_url: string | null;
  about_us_image_url: string | null;
  slider: { title: string; description: string; image_url: string | null }[];
  recaptcha_site_key?: string | null;
  contact_enabled?: boolean;
}

interface NewsItem {
  frontend_news_id: number;
  title: string;
  description: string;
  date_added: number;
  image_url: string | null;
}
interface NoticeItem {
  notice_id: number;
  notice_title: string;
  notice: string;
  create_timestamp: string;
  image_url?: string | null;
}
interface EventItem {
  frontend_events_id: number;
  title: string;
  timestamp: number;
}
interface GalleryItem {
  frontend_gallery_id: number;
  title: string;
  description: string;
  image_url: string | null;
}
interface TeacherItem {
  teacher_id: number;
  name: string;
  designation: string | null;
  about: string | null;
  image_url: string | null;
  social_links?: Record<string, string>;
}

const useSite = () => useGet<Site>("/public/site");
const schoolName = (site: Site | undefined) => site?.school_title || site?.system_name || tr("School");

const MAIN_LINKS = [
  { to: "/", label: tr("Home") },
  { to: "/about", label: tr("About") },
  { to: "/teachers", label: tr("Teachers") },
];
const LIFE_LINKS = [
  { to: "/notices", label: tr("Notices"), icon: MegaphoneIcon, description: tr("Announcements from the school office") },
  { to: "/news", label: tr("News"), icon: NewspaperIcon, description: tr("Stories and updates from campus") },
  { to: "/events", label: tr("Events"), icon: CalendarDaysIcon, description: tr("What is happening and when") },
  { to: "/gallery", label: tr("Gallery"), icon: ImageIcon, description: tr("Photos from school life") },
];
const END_LINKS = [
  { to: "/admission", label: tr("Admission") },
  { to: "/contact", label: tr("Contact") },
];
const ALL_LINKS = [...MAIN_LINKS, ...LIFE_LINKS, ...END_LINKS];

const SOCIAL_LABEL: Record<string, string> = {
  facebook: tr("Facebook"),
  twitter: tr("X / Twitter"),
  google: tr("Google"),
  instagram: tr("Instagram"),
  linkedin: tr("LinkedIn"),
  youtube: tr("YouTube"),
};
const validSocial = (links: Record<string, string> | undefined) => Object.entries(links ?? {}).filter(([, url]) => /^https?:\/\//.test(url ?? ""));

/** "lat,lng" from the website settings, or null. */
function mapCoords(location: string | null | undefined) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(location ?? "");
  return m ? `${m[1]},${m[2]}` : null;
}

function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>{children}</div>;
}

/** Plain text with line breaks; legacy content is never injected as HTML. */
function Prose({ text, className }: { text: string | null | undefined; className?: string }) {
  return <div className={cn("text-foreground/80 leading-relaxed whitespace-pre-wrap", className)}>{text || ""}</div>;
}

function SectionHeading({ eyebrow, title, action, center }: { eyebrow?: string; title: string; action?: { to: string; label: string }; center?: boolean }) {
  return (
    <div className={cn("mb-8 flex flex-wrap items-end justify-between gap-3", center && "flex-col items-center text-center")}>
      <div>
        {eyebrow && (
          <p className={cn("text-primary mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.2em] uppercase", center && "justify-center")}>
            <span className="bg-gold h-0.5 w-6 rounded-full" />
            {eyebrow}
          </p>
        )}
        <h2 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      </div>
      {action && (
        <Button asChild variant="outline" size="sm" className="rounded-full">
          <Link to={action.to}>
            {action.label}
            <ArrowRightIcon />
          </Link>
        </Button>
      )}
    </div>
  );
}

/** Decorative dot grid used behind bands of brand colour. */
function Dots({ className }: { className?: string }) {
  return <div aria-hidden className={cn("site-dots pointer-events-none absolute inset-0", className)} />;
}

/** Title band at the top of inner pages, with a trail back to the home page. */
function PageHero({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="no-print bg-ink relative isolate overflow-hidden text-white">
      <Dots className="text-white/[0.07]" />
      <div aria-hidden className="bg-primary/60 absolute -top-24 -right-24 size-80 rounded-full blur-3xl" />
      <div aria-hidden className="bg-gold/20 absolute -bottom-32 left-1/4 size-72 rounded-full blur-3xl" />
      <Container className="relative py-14 sm:py-20">
        <nav className="mb-4 flex items-center gap-1.5 text-sm text-white/60">
          <Link to="/" className="hover:text-white">
            {tr("Home")}
          </Link>
          <ChevronRightIcon className="size-3.5" />
          <span className="truncate text-white/90">{title}</span>
        </nav>
        <h1 className="font-display max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-lg text-white/75">{subtitle}</p>}
        {children}
      </Container>
    </div>
  );
}

function useActive() {
  const { pathname } = useLocation();
  return (to: string) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`));
}

function Crest({ site, name, className }: { site: Site | undefined; name: string; className?: string }) {
  return site?.header_logo_url ? (
    <img src={site.header_logo_url} alt="" className={cn("h-11 w-auto shrink-0", className)} />
  ) : (
    <span className={cn("bg-primary text-primary-foreground ring-gold/60 font-display flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-2 ring-offset-2 ring-offset-transparent", className)}>
      {initials(name)}
    </span>
  );
}

export function PublicLayout() {
  const settings = usePublicSettings();
  const { data: site } = useSite();
  const [open, setOpen] = useState(false);
  const isActive = useActive();
  const { pathname } = useLocation();
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);
  if (settings.data?.disable_frontend === "1") return <Navigate to="/login" replace />;
  const name = schoolName(site);
  const social = validSocial(site?.social_links);

  const navLink = (to: string, label: string) => (
    <NavigationMenuItem key={to}>
      <NavigationMenuLink
        asChild
        active={isActive(to)}
        className={cn(
          navigationMenuTriggerStyle(),
          "relative flex-row bg-transparent data-[active=true]:bg-transparent data-[active=true]:text-primary",
          "after:bg-gold after:absolute after:inset-x-4 after:-bottom-[13px] after:h-0.5 after:origin-left after:scale-x-0 after:rounded-full after:transition-transform data-[active=true]:after:scale-x-100",
        )}
      >
        <Link to={to}>{label}</Link>
      </NavigationMenuLink>
    </NavigationMenuItem>
  );

  return (
    <div className="site-theme bg-background text-foreground flex min-h-svh flex-col">
      {(site?.phone || site?.email || social.length > 0) && (
        <div className="no-print bg-ink hidden text-xs text-white/70 md:block">
          <Container className="flex h-9 items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-5">
              {site?.phone && (
                <a href={`tel:${site.phone}`} className="flex items-center gap-1.5 hover:text-white">
                  <PhoneIcon className="text-gold size-3.5" />
                  {site.phone}
                </a>
              )}
              {site?.email && (
                <a href={`mailto:${site.email}`} className="flex min-w-0 items-center gap-1.5 hover:text-white">
                  <MailIcon className="text-gold size-3.5 shrink-0" />
                  <span className="truncate">{site.email}</span>
                </a>
              )}
            </div>
            {social.length > 0 && (
              <div className="flex shrink-0 items-center gap-4">
                {social.map(([k, url]) => (
                  <a key={k} href={url} target="_blank" rel="noopener noreferrer" className="hover:text-white">
                    {SOCIAL_LABEL[k] ?? k}
                  </a>
                ))}
              </div>
            )}
          </Container>
        </div>
      )}

      <header className="bg-background/90 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-40 border-b shadow-[0_1px_0_0_rgb(0_0_0/0.02)] backdrop-blur-md">
        <Container className="flex h-[4.25rem] items-center justify-between gap-4">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <Crest site={site} name={name} />
            <span className="font-display truncate text-lg leading-tight font-semibold tracking-tight sm:text-xl">{name}</span>
          </Link>

          <NavigationMenu viewport={false} className="hidden lg:flex">
            <NavigationMenuList>
              {MAIN_LINKS.map((l) => navLink(l.to, l.label))}
              <NavigationMenuItem>
                <NavigationMenuTrigger className={cn("bg-transparent", LIFE_LINKS.some((l) => isActive(l.to)) && "text-primary")}>{tr("School life")}</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid w-[32rem] grid-cols-2 gap-1 p-2">
                    {LIFE_LINKS.map((l) => (
                      <li key={l.to}>
                        <NavigationMenuLink asChild active={isActive(l.to)}>
                          <Link to={l.to} className="flex-row items-start gap-3 rounded-lg p-3">
                            <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                              <l.icon className="text-primary! size-4.5!" />
                            </span>
                            <span className="grid gap-0.5">
                              <span className="font-medium">{l.label}</span>
                              <span className="text-muted-foreground text-xs leading-snug">{l.description}</span>
                            </span>
                          </Link>
                        </NavigationMenuLink>
                      </li>
                    ))}
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
              {END_LINKS.map((l) => navLink(l.to, l.label))}
            </NavigationMenuList>
          </NavigationMenu>

          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button asChild size="sm" className="hidden rounded-full px-4 shadow-sm sm:inline-flex">
              <Link to="/login">
                <LogInIcon />
                {tr("Portal login")}</Link>
            </Button>
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label={tr("Open menu")}>
                  <MenuIcon />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="site-theme w-full overflow-y-auto sm:max-w-xs">
                <SheetHeader className="border-b">
                  <SheetTitle className="flex items-center gap-3">
                    <Crest site={site} name={name} className="size-9 text-xs" />
                    <span className="font-display">{name}</span>
                  </SheetTitle>
                </SheetHeader>
                <nav className="grid gap-1 px-4">
                  {ALL_LINKS.map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      className={cn(
                        "hover:bg-accent rounded-lg border-l-2 border-transparent px-3 py-2.5 text-base font-medium transition-colors",
                        isActive(l.to) && "bg-accent text-primary border-gold",
                      )}
                    >
                      {l.label}
                    </Link>
                  ))}
                </nav>
                <div className="mt-4 grid gap-2 px-4 pb-6">
                  <Button asChild className="rounded-full">
                    <Link to="/login">
                      <LogInIcon />
                      {tr("Portal login")}</Link>
                  </Button>
                  {site?.phone && (
                    <Button asChild variant="outline" className="rounded-full">
                      <a href={`tel:${site.phone}`}>
                        <PhoneIcon />
                        {site.phone}
                      </a>
                    </Button>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </Container>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="no-print bg-ink relative isolate mt-24 overflow-hidden text-white/65">
        <Dots className="text-white/[0.04]" />
        <div aria-hidden className="via-gold absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent to-transparent" />
        <Container className="relative grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {site?.footer_logo_url ? (
                <img src={site.footer_logo_url} alt="" className="h-11 w-auto" />
              ) : (
                <Crest site={undefined} name={name} />
              )}
              <span className="font-display text-lg font-semibold text-white">{name}</span>
            </div>
            {site?.homepage_note_description && <p className="line-clamp-4 text-sm leading-relaxed">{site.homepage_note_description}</p>}
            {social.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {social.map(([k, url]) => (
                  <a
                    key={k}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:border-gold hover:text-gold rounded-full border border-white/15 px-3 py-1 text-xs text-white/80 transition-colors"
                  >
                    {SOCIAL_LABEL[k] ?? k}
                  </a>
                ))}
              </div>
            )}
          </div>
          <FooterLinks title={tr("School")} links={[...MAIN_LINKS.slice(1), ...END_LINKS, { to: "/login", label: tr("Portal login") }]} />
          <FooterLinks title={tr("School life")} links={LIFE_LINKS} />
          <div className="space-y-4">
            <FooterTitle>{tr("Get in touch")}</FooterTitle>
            <ul className="space-y-3 text-sm">
              {site?.address && (
                <li className="flex gap-2.5">
                  <MapPinIcon className="text-gold mt-0.5 size-4 shrink-0" />
                  <span>{site.address}</span>
                </li>
              )}
              {site?.phone && (
                <li className="flex gap-2.5">
                  <PhoneIcon className="text-gold mt-0.5 size-4 shrink-0" />
                  <a href={`tel:${site.phone}`} className="hover:text-white">
                    {site.phone}
                  </a>
                </li>
              )}
              {site?.email && (
                <li className="flex gap-2.5">
                  <MailIcon className="text-gold mt-0.5 size-4 shrink-0" />
                  <a href={`mailto:${site.email}`} className="break-all hover:text-white">
                    {site.email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </Container>
        <div className="relative border-t border-white/10">
          <Container className="flex flex-col gap-2 py-5 text-xs sm:flex-row sm:items-center sm:justify-between">
            <p>{site?.copyright_text || tr("© {getFullYear} {name}. All rights reserved.", { getFullYear: new Date().getFullYear(), name })}</p>
            <div className="flex gap-4">
              <Link to="/terms" className="hover:text-white">
                {tr("Terms & conditions")}</Link>
              <Link to="/privacy" className="hover:text-white">
                {tr("Privacy policy")}</Link>
            </div>
          </Container>
        </div>
      </footer>
    </div>
  );
}

function FooterTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-display relative pb-2 text-base font-semibold text-white after:bg-gold after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-8 after:rounded-full">
      {children}
    </h3>
  );
}

function FooterLinks({ title, links }: { title: string; links: { to: string; label: string }[] }) {
  return (
    <div className="space-y-4">
      <FooterTitle>{title}</FooterTitle>
      <ul className="space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="group inline-flex items-center gap-1.5 transition-colors hover:text-white">
              <ChevronRightIcon className="text-gold size-3.5 transition-transform group-hover:translate-x-0.5" />
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- shared cards ---------------------------------------------------------------

function NewsCard({ n }: { n: NewsItem }) {
  return (
    <Link to={`/news/${n.frontend_news_id}`} className="group">
      <Card className="h-full gap-0 overflow-hidden rounded-2xl py-0 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-xl">
        <div className="bg-muted relative aspect-[16/10] overflow-hidden">
          {n.image_url ? (
            <img src={n.image_url} alt="" className="size-full object-cover transition-transform duration-700 group-hover:scale-105" />
          ) : (
            <div className="from-primary/15 to-gold/15 text-primary/50 flex size-full items-center justify-center bg-gradient-to-br">
              <NewspaperIcon className="size-10" />
            </div>
          )}
          <span className="bg-background/95 text-foreground absolute top-3 left-3 rounded-full px-3 py-1 text-xs font-medium shadow-sm">{fromUnix(n.date_added)}</span>
        </div>
        <CardContent className="flex flex-1 flex-col gap-2 p-6">
          <h3 className="font-display group-hover:text-primary line-clamp-2 text-lg leading-snug font-semibold transition-colors">{n.title}</h3>
          <p className="text-muted-foreground line-clamp-3 text-sm leading-relaxed">{n.description}</p>
          <span className="text-primary mt-auto inline-flex items-center gap-1 pt-2 text-sm font-medium">
            {tr("Learn more")}
            <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-1" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

function DateTile({ ts, className }: { ts: number | string; className?: string }) {
  return (
    <div className={cn("bg-background flex w-16 shrink-0 flex-col overflow-hidden rounded-xl border text-center shadow-sm", className)}>
      <span className="bg-primary text-primary-foreground py-0.5 text-[10px] font-semibold tracking-wider uppercase">{fromUnix(ts, "MMM")}</span>
      <span className="font-display py-1 text-2xl leading-none font-semibold">{fromUnix(ts, "DD")}</span>
      <span className="text-muted-foreground pb-1 text-[10px]">{fromUnix(ts, "YYYY")}</span>
    </div>
  );
}

function TeacherCard({ t }: { t: TeacherItem }) {
  const social = validSocial(t.social_links);
  return (
    <Card className="group gap-0 overflow-hidden rounded-2xl py-0 text-center transition-shadow hover:shadow-xl">
      <div className="bg-muted relative aspect-[4/5] overflow-hidden">
        {t.image_url ? (
          <img src={t.image_url} alt={t.name} className="size-full object-cover transition-transform duration-700 group-hover:scale-105" />
        ) : (
          <div className="from-primary/20 to-gold/20 text-primary font-display flex size-full items-center justify-center bg-gradient-to-br text-4xl font-semibold">{initials(t.name)}</div>
        )}
        <div aria-hidden className="bg-gold absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 transition-transform duration-500 group-hover:scale-x-100" />
      </div>
      <CardContent className="space-y-1 p-5">
        <h3 className="font-display text-lg font-semibold">{t.name}</h3>
        {t.designation && <p className="text-primary text-xs font-semibold tracking-wider uppercase">{t.designation}</p>}
        {t.about && <p className="text-muted-foreground line-clamp-3 pt-1 text-sm">{t.about}</p>}
        {social.length > 0 && (
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 pt-2 text-xs">
            {social.map(([k, url]) => (
              <a key={k} href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                {SOCIAL_LABEL[k] ?? k}
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GalleryCard({ g, className }: { g: GalleryItem; className?: string }) {
  return (
    <Link to={`/gallery/${g.frontend_gallery_id}`} className={cn("group relative block min-h-56 overflow-hidden rounded-2xl", className)}>
      <div className="bg-muted absolute inset-0">
        {g.image_url ? (
          <img src={g.image_url} alt="" className="size-full object-cover transition-transform duration-700 group-hover:scale-105" />
        ) : (
          <div className="from-primary/20 to-gold/20 text-primary/50 flex size-full items-center justify-center bg-gradient-to-br">
            <ImageIcon className="size-10" />
          </div>
        )}
      </div>
      <div className="from-ink/90 via-ink/30 absolute inset-0 bg-gradient-to-t to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        <h3 className="font-display text-lg font-semibold">{g.title}</h3>
        {g.description && <p className="line-clamp-1 text-sm text-white/80">{g.description}</p>}
      </div>
    </Link>
  );
}

function GridSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-6 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="aspect-[4/3] w-full rounded-2xl" />
      ))}
    </div>
  );
}

// --- home -----------------------------------------------------------------------

function HeroSlider({ site }: { site: Site | undefined }) {
  const slides = (site?.slider ?? []).filter((s) => s.image_url);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % slides.length), 6000);
    return () => clearInterval(t);
  }, [slides.length]);
  const slide = slides[index % Math.max(slides.length, 1)];
  const name = schoolName(site);
  const title = slide?.title || name;
  const description = slide?.description || site?.homepage_note_title || tr("Welcome to {name}", { name });
  const go = (step: number) => setIndex((i) => (i + step + slides.length) % slides.length);
  const current = index % Math.max(slides.length, 1);

  const ctas = (
    <div className="mt-9 flex flex-wrap gap-3">
      <Button asChild size="lg" className="bg-gold text-ink hover:bg-gold/90 h-12 rounded-full px-6 font-semibold shadow-lg">
        <Link to="/admission">
          <ClipboardListIcon />
          {tr("Admission")}</Link>
      </Button>
      <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-white/30 bg-white/10 px-6 text-white backdrop-blur hover:bg-white/20 hover:text-white">
        <Link to="/contact">
          <MailIcon />
          {tr("Contact us")}</Link>
      </Button>
      <Button asChild size="lg" variant="ghost" className="h-12 rounded-full px-5 text-white hover:bg-white/10 hover:text-white">
        <Link to="/login">
          <LogInIcon />
          {tr("Portal login")}</Link>
      </Button>
    </div>
  );
  const controls = slides.length > 1 && (
    <div className="mt-12 flex items-center gap-4">
      <button type="button" aria-label={tr("Previous slide")} onClick={() => go(-1)} className="rounded-full border border-white/30 p-2.5 transition-colors hover:bg-white/15">
        <ChevronLeftIcon className="size-4" />
      </button>
      <div className="flex items-center gap-2">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={tr("Slide {value}", { value: i + 1 })}
            onClick={() => setIndex(i)}
            className={cn("h-1.5 rounded-full transition-all", i === current ? "bg-gold w-10" : "w-3 bg-white/50 hover:bg-white/80")}
          />
        ))}
      </div>
      <button type="button" aria-label={tr("Next slide")} onClick={() => go(1)} className="rounded-full border border-white/30 p-2.5 transition-colors hover:bg-white/15">
        <ChevronRightIcon className="size-4" />
      </button>
    </div>
  );
  const text = (
    <div className="relative">
      <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold tracking-[0.18em] text-white/90 uppercase backdrop-blur">
        <GraduationCapIcon className="text-gold size-4" />
        {name}
      </p>
      <h1 key={title} className="font-display animate-in fade-in slide-in-from-bottom-3 max-w-3xl text-4xl leading-[1.08] font-semibold tracking-tight text-balance duration-700 sm:text-5xl lg:text-6xl">
        {title}
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/80">{description}</p>
      {ctas}
      {controls}
    </div>
  );

  // Photos uploaded under Website → Slider fill the band; without any, a patterned brand band with the crest.
  const framed = site?.theme === "ultimate";
  if (slides.length && !framed)
    return (
      <section className="bg-ink relative isolate overflow-hidden text-white">
        {slides.map((s, i) => (
          <img
            key={s.image_url}
            src={s.image_url!}
            alt=""
            className={cn("absolute inset-0 size-full object-cover transition-all duration-[1500ms]", i === current ? "scale-100 opacity-100" : "scale-105 opacity-0")}
          />
        ))}
        <div className="from-ink via-ink/75 to-ink/20 absolute inset-0 bg-gradient-to-r" />
        <div className="from-ink/60 absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t to-transparent" />
        <Container className="relative flex min-h-[32rem] flex-col justify-center py-24 sm:min-h-[38rem]">{text}</Container>
      </section>
    );

  return (
    <section className="bg-ink relative isolate overflow-hidden text-white">
      <Dots className="text-white/[0.07]" />
      <div aria-hidden className="bg-primary absolute -top-40 -left-40 size-[34rem] rounded-full opacity-70 blur-3xl" />
      <div aria-hidden className="bg-gold/25 absolute -right-20 -bottom-40 size-[28rem] rounded-full blur-3xl" />
      <Container className="relative grid min-h-[32rem] items-center gap-12 py-24 sm:min-h-[36rem] lg:grid-cols-[1.4fr_1fr]">
        {text}
        {framed && slides.length ? (
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-white/10 shadow-2xl ring-1 ring-white/20">
            {slides.map((s, i) => (
              <img
                key={s.image_url}
                src={s.image_url!}
                alt=""
                className={cn("absolute inset-0 size-full object-cover transition-opacity duration-1000", i === current ? "opacity-100" : "opacity-0")}
              />
            ))}
          </div>
        ) : (
        <div aria-hidden className="relative mx-auto hidden aspect-square w-full max-w-sm lg:block">
          <div className="absolute inset-0 rounded-full border border-white/15" />
          <div className="border-gold/40 absolute inset-8 rounded-full border border-dashed" />
          <div className="absolute inset-16 flex items-center justify-center rounded-full bg-white/10 shadow-2xl ring-1 ring-white/20 backdrop-blur">
            {site?.header_logo_url ? (
              <img src={site.header_logo_url} alt="" className="max-h-[55%] max-w-[55%] object-contain" />
            ) : (
              <span className="font-display text-gold text-7xl font-semibold">{initials(name)}</span>
            )}
          </div>
          <span className="bg-gold text-ink absolute top-10 right-0 flex size-14 items-center justify-center rounded-2xl shadow-xl">
            <BookOpenIcon className="size-6" />
          </span>
          <span className="bg-primary text-primary-foreground absolute bottom-8 left-0 flex size-14 items-center justify-center rounded-2xl shadow-xl ring-1 ring-white/20">
            <GraduationCapIcon className="size-6" />
          </span>
        </div>
        )}
      </Container>
    </section>
  );
}

export function HomePage() {
  const { data: site } = useSite();
  const news = useGet<NewsItem[]>("/public/news", { limit: 3 });
  const notices = useGet<NoticeItem[]>("/public/notices");
  const events = useGet<EventItem[]>("/public/events");
  const teachers = useGet<TeacherItem[]>("/public/teachers");
  const gallery = useGet<GalleryItem[]>("/public/gallery");
  const today = dayjs().startOf("day").unix();
  const contacts = [
    site?.address && { icon: MapPinIcon, label: tr("Visit us"), value: site.address },
    site?.phone && { icon: PhoneIcon, label: tr("Call us"), value: site.phone, href: `tel:${site.phone}` },
    site?.email && { icon: MailIcon, label: tr("Email us"), value: site.email, href: `mailto:${site.email}` },
  ].filter(Boolean) as { icon: typeof MailIcon; label: string; value: string; href?: string }[];

  return (
    <>
      <HeroSlider site={site} />

      {contacts.length > 0 && (
        <Container className="relative z-10 -mt-12">
          <div className={cn("bg-card grid divide-y overflow-hidden rounded-2xl border shadow-xl sm:divide-x sm:divide-y-0", contacts.length === 3 ? "sm:grid-cols-3" : contacts.length === 2 ? "sm:grid-cols-2" : "")}>
            {contacts.map((c) => (
              <div key={c.label} className="flex items-center gap-4 p-6">
                <span className="bg-gold/15 text-ink flex size-12 shrink-0 items-center justify-center rounded-2xl">
                  <c.icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{c.label}</p>
                  {c.href ? (
                    <a href={c.href} className="hover:text-primary block truncate font-medium">
                      {c.value}
                    </a>
                  ) : (
                    <p className="truncate font-medium">{c.value}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Container>
      )}

      <Container className="mt-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LIFE_LINKS.map((l, i) => (
            <Link
              key={l.to}
              to={l.to}
              className="group bg-card hover:border-primary/30 relative overflow-hidden rounded-2xl border p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
            >
              <span className="font-display text-muted-foreground/15 absolute top-3 right-5 text-5xl font-semibold">{String(i + 1).padStart(2, "0")}</span>
              <span className="bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground flex size-12 items-center justify-center rounded-xl transition-colors">
                <l.icon className="size-5" />
              </span>
              <h3 className="font-display mt-5 text-lg font-semibold">{l.label}</h3>
              <p className="text-muted-foreground mt-1 text-sm">{l.description}</p>
              <ArrowRightIcon className="text-primary mt-4 size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          ))}
        </div>
      </Container>

      {(site?.homepage_note_title || site?.about_us) && (
        <Container className="mt-24 grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="relative">
            <div aria-hidden className="bg-gold/30 absolute -top-4 -left-4 size-32 rounded-3xl" />
            <div aria-hidden className="site-dots text-primary/30 absolute -right-4 -bottom-4 size-40" />
            <div className="bg-muted relative aspect-[4/3] overflow-hidden rounded-3xl shadow-xl">
              {site?.about_us_image_url ? (
                <img src={site.about_us_image_url} alt="" className="size-full object-cover" />
              ) : (
                <div className="from-primary to-ink text-gold flex size-full items-center justify-center bg-gradient-to-br">
                  <UsersIcon className="size-16" />
                </div>
              )}
            </div>
          </div>
          <div>
            <p className="text-primary mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.2em] uppercase">
              <span className="bg-gold h-0.5 w-6 rounded-full" />
              {tr("About us")}
            </p>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {site?.homepage_note_title || tr("Welcome to {schoolName}", { schoolName: schoolName(site) })}
            </h2>
            <Prose text={site?.homepage_note_description || site?.about_us} className="text-muted-foreground mt-5 line-clamp-[10] text-base" />
            <Button asChild className="mt-8 rounded-full px-6">
              <Link to="/about">
                {tr("Learn more")}<ArrowRightIcon />
              </Link>
            </Button>
          </div>
        </Container>
      )}

      <section className="bg-muted/70 relative mt-24 py-20">
        <Container className="grid gap-8 lg:grid-cols-2">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="space-y-1.5">
                <CardTitle className="font-display flex items-center gap-2.5 text-xl">
                  <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                    <MegaphoneIcon className="size-4.5" />
                  </span>
                  {tr("Latest notices")}</CardTitle>
                <CardDescription>{tr("Announcements from the school office")}</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/notices">
                  {tr("View all")}<ArrowRightIcon />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {notices.isLoading && <Skeleton className="h-40 w-full" />}
              {notices.data?.length === 0 && <p className="text-muted-foreground text-sm">{tr("No notices at the moment.")}</p>}
              <ul className="space-y-1">
                {notices.data?.slice(0, 5).map((n) => (
                  <li key={n.notice_id}>
                    <Link to={`/notices/${n.notice_id}`} className="group hover:bg-muted/70 -mx-3 flex items-center gap-4 rounded-lg px-3 py-3 transition-colors">
                      <span className="bg-gold size-2 shrink-0 rounded-full" />
                      <span className="group-hover:text-primary min-w-0 flex-1 font-medium transition-colors">{n.notice_title}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">{fromUnix(n.create_timestamp)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="space-y-1.5">
                <CardTitle className="font-display flex items-center gap-2.5 text-xl">
                  <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                    <CalendarDaysIcon className="size-4.5" />
                  </span>
                  {tr("Events")}</CardTitle>
                <CardDescription>{tr("Dates for your calendar")}</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/events">
                  {tr("View all")}<ArrowRightIcon />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {events.isLoading && <Skeleton className="h-40 w-full" />}
              {events.data?.length === 0 && <p className="text-muted-foreground text-sm">{tr("No events scheduled.")}</p>}
              <ul className="space-y-3">
                {events.data?.slice(0, 4).map((e) => (
                  <li key={e.frontend_events_id} className="flex items-center gap-4">
                    <DateTile ts={e.timestamp} />
                    <div className="min-w-0">
                      <p className="font-medium">{e.title}</p>
                      <p className="text-muted-foreground text-xs">{e.timestamp >= today ? tr("Upcoming") : tr("Past")} · {fromUnix(e.timestamp, "dddd")}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </Container>
      </section>

      <Container className="mt-24">
        <SectionHeading eyebrow={tr("Stay informed")} title={tr("Latest news")} action={{ to: "/news", label: tr("All news") }} />
        {news.isLoading && <GridSkeleton />}
        {news.data?.length === 0 && <EmptyState icon={NewspaperIcon} title={tr("No news yet")} />}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {news.data?.map((n) => (
            <NewsCard key={n.frontend_news_id} n={n} />
          ))}
        </div>
      </Container>

      {!!teachers.data?.length && (
        <Container className="mt-24">
          <SectionHeading eyebrow={tr("Our people")} title={tr("Meet our teachers")} action={{ to: "/teachers", label: tr("All teachers") }} />
          <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
            {teachers.data.slice(0, 4).map((t) => (
              <TeacherCard key={t.teacher_id} t={t} />
            ))}
          </div>
        </Container>
      )}

      {!!gallery.data?.length && (
        <Container className="mt-24">
          <SectionHeading eyebrow={tr("School life")} title={tr("Gallery")} action={{ to: "/gallery", label: tr("All albums") }} />
          <div className="grid auto-rows-[14rem] gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.data.slice(0, 5).map((g, i) => (
              <GalleryCard key={g.frontend_gallery_id} g={g} className={cn(i === 0 && "sm:col-span-2 lg:row-span-2")} />
            ))}
          </div>
        </Container>
      )}

      <Container className="mt-24">
        <div className="bg-ink relative isolate overflow-hidden rounded-3xl px-6 py-14 text-white sm:px-14">
          <Dots className="text-white/[0.06]" />
          <div aria-hidden className="bg-primary absolute -top-24 -right-16 size-80 rounded-full opacity-80 blur-3xl" />
          <div aria-hidden className="bg-gold/30 absolute -bottom-28 left-1/4 size-64 rounded-full blur-3xl" />
          <div className="relative flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
            <div>
              <span className="bg-gold/20 text-gold mb-4 inline-flex size-12 items-center justify-center rounded-2xl">
                <GraduationCapIcon className="size-6" />
              </span>
              <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{tr("Admissions are open")}</h2>
              <p className="mt-3 max-w-xl text-white/75">
                {tr("Download the admission form, fill it in and bring it to the school office, or get in touch with any questions.")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-gold text-ink hover:bg-gold/90 h-12 rounded-full px-6 font-semibold">
                <Link to="/admission">
                  <ClipboardListIcon />
                  {tr("Admission form")}</Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="h-12 rounded-full px-5 text-white hover:bg-white/10 hover:text-white">
                <Link to="/contact">
                  {tr("Contact us")}<ArrowRightIcon />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </>
  );
}

// --- inner pages ----------------------------------------------------------------

export function PublicNoticesPage() {
  const { data, isLoading } = useGet<NoticeItem[]>("/public/notices");
  return (
    <>
      <PageHero title={tr("Noticeboard")} subtitle={tr("Official announcements from the school")} />
      <Container className="mt-10 max-w-4xl space-y-4">
        {isLoading && <Skeleton className="h-28 w-full" />}
        {data?.length === 0 && <EmptyState icon={MegaphoneIcon} title={tr("No notices")} />}
        {data?.map((n) => (
          <Link key={n.notice_id} to={`/notices/${n.notice_id}`} className="group block">
            <Card className="flex-row items-start gap-4 rounded-2xl p-5 transition-all group-hover:-translate-y-0.5 group-hover:shadow-lg">
              <DateTile ts={n.create_timestamp} />
              <div className="min-w-0 space-y-1">
                <h2 className="font-display group-hover:text-primary text-lg font-semibold transition-colors">{n.notice_title}</h2>
                <p className="text-muted-foreground line-clamp-2 text-sm">{n.notice}</p>
              </div>
            </Card>
          </Link>
        ))}
      </Container>
    </>
  );
}

function ArticleSkeleton() {
  return (
    <Container className="mt-10 max-w-3xl space-y-4">
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="aspect-video w-full" />
    </Container>
  );
}

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
      <Link to={to}>
        <ArrowLeftIcon />
        {label}
      </Link>
    </Button>
  );
}

export function PublicNoticePage() {
  const { id } = useParams();
  const { data } = useGet<NoticeItem>(`/public/notices/${id}`);
  if (!data) return <ArticleSkeleton />;
  return (
    <Container className="mt-12 max-w-3xl">
      <BackLink to="/notices" label={tr("All notices")} />
      <Badge variant="secondary" className="mb-3">
        <MegaphoneIcon />
        {tr("Notice")}</Badge>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{data.notice_title}</h1>
      <p className="text-muted-foreground mt-2 mb-8">{fromUnix(data.create_timestamp, "dddd, DD MMMM YYYY")}</p>
      {data.image_url && <img src={data.image_url} alt="" className="mb-8 w-full rounded-2xl shadow-lg" />}
      <Prose text={data.notice} className="text-lg" />
    </Container>
  );
}

export function PublicNewsPage() {
  const { data, isLoading } = useGet<NewsItem[]>("/public/news", { limit: 50 });
  return (
    <>
      <PageHero title={tr("News")} subtitle={tr("Stories and updates from our school community")} />
      <Container className="mt-10">
        {isLoading && <GridSkeleton count={6} />}
        {data?.length === 0 && <EmptyState icon={NewspaperIcon} title={tr("No news yet")} />}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {data?.map((n) => (
            <NewsCard key={n.frontend_news_id} n={n} />
          ))}
        </div>
      </Container>
    </>
  );
}

export function PublicNewsItemPage() {
  const { id } = useParams();
  const { data } = useGet<NewsItem>(`/public/news/${id}`);
  if (!data) return <ArticleSkeleton />;
  return (
    <Container className="mt-12 max-w-3xl">
      <BackLink to="/news" label={tr("All news")} />
      <h1 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{data.title}</h1>
      <p className="text-muted-foreground mt-2 mb-8">{fromUnix(data.date_added, "dddd, DD MMMM YYYY")}</p>
      {data.image_url && <img src={data.image_url} alt="" className="mb-8 w-full rounded-2xl shadow-lg" />}
      <Prose text={data.description} className="text-lg" />
    </Container>
  );
}

export function PublicEventsPage() {
  const { data, isLoading } = useGet<EventItem[]>("/public/events");
  const today = dayjs().startOf("day").unix();
  return (
    <>
      <PageHero title={tr("Events")} subtitle={tr("Important dates in the school calendar")} />
      <Container className="mt-10 max-w-4xl space-y-3">
        {isLoading && <Skeleton className="h-24 w-full" />}
        {data?.length === 0 && <EmptyState icon={CalendarDaysIcon} title={tr("No events")} />}
        {data?.map((e) => (
          <Card key={e.frontend_events_id} className="flex-row items-center gap-4 rounded-2xl p-4 transition-shadow hover:shadow-md">
            <DateTile ts={e.timestamp} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{e.title}</p>
              <p className="text-muted-foreground text-sm">{fromUnix(e.timestamp, "dddd, DD MMMM YYYY")}</p>
            </div>
            {e.timestamp >= today ? (
              <Badge className="bg-success/15 text-success border-transparent">{tr("Upcoming")}</Badge>
            ) : (
              <Badge variant="secondary">{tr("Past")}</Badge>
            )}
          </Card>
        ))}
      </Container>
    </>
  );
}

export function PublicGalleryPage() {
  const { data, isLoading } = useGet<GalleryItem[]>("/public/gallery");
  return (
    <>
      <PageHero title={tr("Gallery")} subtitle={tr("Moments from school life")} />
      <Container className="mt-10">
        {isLoading && <GridSkeleton count={6} />}
        {data?.length === 0 && <EmptyState icon={ImageIcon} title={tr("No albums yet")} />}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.map((g) => (
            <GalleryCard key={g.frontend_gallery_id} g={g} />
          ))}
        </div>
      </Container>
    </>
  );
}

export function PublicGalleryItemPage() {
  const { id } = useParams();
  const { data } = useGet<{ title: string; description: string; images: { frontend_gallery_image_id: number; image_url: string; title: string }[] }>(`/public/gallery/${id}`);
  const [open, setOpen] = useState<number | null>(null);
  if (!data) return <ArticleSkeleton />;
  const current = open !== null ? data.images[open] : undefined;
  const step = (d: number) => setOpen((i) => (i === null ? i : (i + d + data.images.length) % data.images.length));
  return (
    <>
      <PageHero title={data.title} subtitle={data.description}>
        <p className="mt-3 text-sm opacity-70">{tn("{length} photos", { length: data.images.length })}</p>
      </PageHero>
      <Container className="mt-10">
        <BackLink to="/gallery" label={tr("All albums")} />
        {data.images.length === 0 && <EmptyState icon={ImageIcon} title={tr("No photos in this album yet")} />}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.images.map((img, i) => (
            <button key={img.frontend_gallery_image_id} type="button" onClick={() => setOpen(i)} className="group bg-muted aspect-square overflow-hidden rounded-lg">
              <img src={img.image_url} alt={img.title ?? ""} className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
            </button>
          ))}
        </div>
      </Container>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] gap-3 p-3 sm:max-w-4xl">
          <DialogTitle className="sr-only">{current?.title || data.title}</DialogTitle>
          {current && <img src={current.image_url} alt={current.title ?? ""} className="max-h-[75vh] w-full rounded-md object-contain" />}
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="icon-sm" aria-label={tr("Previous photo")} onClick={() => step(-1)}>
              <ChevronLeftIcon />
            </Button>
            <span className="text-muted-foreground truncate text-sm">
              {current?.title || tr("{value} / {length}", { value: (open ?? 0) + 1, length: data.images.length })}
            </span>
            <div className="flex gap-2">
              {current && (
                <Button asChild variant="outline" size="icon-sm" aria-label={tr("Open original")}>
                  <a href={current.image_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLinkIcon />
                  </a>
                </Button>
              )}
              <Button variant="outline" size="icon-sm" aria-label={tr("Next photo")} onClick={() => step(1)}>
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PublicTeachersPage() {
  const { data, isLoading } = useGet<TeacherItem[]>("/public/teachers");
  return (
    <>
      <PageHero title={tr("Our teachers")} subtitle={tr("The dedicated people who make learning happen")} />
      <Container className="mt-10">
        {isLoading && <GridSkeleton count={4} className="lg:grid-cols-4" />}
        {data?.length === 0 && <EmptyState icon={UsersIcon} title={tr("No teachers listed yet")} />}
        <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {data?.map((t) => (
            <TeacherCard key={t.teacher_id} t={t} />
          ))}
        </div>
      </Container>
    </>
  );
}

export function PublicTextPage({ field, title }: { field: "about_us" | "terms_conditions" | "privacy_policy"; title: string }) {
  const { data: site, isLoading } = useSite();
  return (
    <>
      <PageHero title={title} subtitle={field === "about_us" ? schoolName(site) : undefined} />
      <Container className={cn("mt-10", field === "about_us" && site?.about_us_image_url ? "grid gap-10 lg:grid-cols-[1fr_1.2fr]" : "max-w-3xl")}>
        {field === "about_us" && site?.about_us_image_url && <img src={site.about_us_image_url} alt="" className="w-full rounded-2xl object-cover" />}
        <div>
          {isLoading && <Skeleton className="h-40 w-full" />}
          {site && (site[field] ? <Prose text={site[field]} className="text-lg" /> : <p className="text-muted-foreground">{tr("Nothing here yet.")}</p>)}
        </div>
      </Container>
    </>
  );
}

// --- contact --------------------------------------------------------------------

interface Grecaptcha {
  render(el: HTMLElement, opts: { sitekey: string; callback?: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void }): number;
  reset(id?: number): void;
}
declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
    onRecaptchaLoaded?: () => void;
  }
}

let recaptchaScript: Promise<void> | null = null;
/** Loads Google's reCAPTCHA script once (explicit render mode). */
function loadRecaptcha(): Promise<void> {
  recaptchaScript ??= new Promise<void>((resolve, reject) => {
    if (window.grecaptcha?.render) return resolve();
    window.onRecaptchaLoaded = () => resolve();
    const s = document.createElement("script");
    s.src = "https://www.google.com/recaptcha/api.js?onload=onRecaptchaLoaded&render=explicit";
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      recaptchaScript = null;
      s.remove();
      reject(new Error(tr("reCAPTCHA failed to load")));
    };
    document.head.appendChild(s);
  });
  return recaptchaScript;
}

function useRecaptcha(siteKey: string | null | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<number | null>(null);
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadRecaptcha()
      .then(() => {
        if (cancelled || !ref.current || widget.current !== null || !window.grecaptcha) return;
        widget.current = window.grecaptcha.render(ref.current, {
          sitekey: siteKey,
          callback: setToken,
          "expired-callback": () => setToken(""),
          "error-callback": () => setToken(""),
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [siteKey]);
  const reset = useCallback(() => {
    if (widget.current !== null) window.grecaptcha?.reset(widget.current);
    setToken("");
  }, []);
  return { ref, token, reset, failed };
}

interface ContactValues {
  name: string;
  email: string;
  phone: string;
  message: string;
}

function ContactForm({ siteKey, onSent }: { siteKey: string | null; onSent: () => void }) {
  const form = useForm<ContactValues>({ defaultValues: { name: "", email: "", phone: "", message: "" } });
  const captcha = useRecaptcha(siteKey);
  const [captchaError, setCaptchaError] = useState(false);
  const send = useAction(async (body: Record<string, unknown>) => (await api.post("/public/contact", body)).data, { onSuccess: onSent });
  const { errors } = form.formState;

  const submit = form.handleSubmit((v) => {
    if (siteKey && !captcha.token) {
      setCaptchaError(true);
      return;
    }
    send.mutate(
      { name: v.name.trim(), email: v.email.trim(), phone: v.phone.trim() || null, message: v.message.trim(), ...(siteKey ? { recaptcha_token: captcha.token } : {}) },
      { onSettled: captcha.reset },
    );
  });

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("Your name")} htmlFor="contact-name" required error={errors.name?.message}>
          <Input id="contact-name" autoComplete="name" aria-invalid={!!errors.name} {...form.register("name", { required: tr("Please enter your name") })} />
        </Field>
        <Field label={tr("Email")} htmlFor="contact-email" required error={errors.email?.message}>
          <Input
            id="contact-email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...form.register("email", { required: tr("Please enter your email"), pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: tr("Enter a valid email address") } })}
          />
        </Field>
      </div>
      <Field label={tr("Phone")} htmlFor="contact-phone" description={tr("Optional")}>
        <Input id="contact-phone" type="tel" autoComplete="tel" {...form.register("phone")} />
      </Field>
      <Field label={tr("Message")} htmlFor="contact-message" required error={errors.message?.message}>
        <Textarea
          id="contact-message"
          rows={6}
          aria-invalid={!!errors.message}
          {...form.register("message", { required: tr("Please write a message"), minLength: { value: 10, message: tr("Message is too short") } })}
        />
      </Field>
      {siteKey && (
        <div className="grid gap-1.5">
          <div ref={captcha.ref} onClick={() => setCaptchaError(false)} />
          {captcha.failed && <p className="text-destructive text-xs">{tr("The spam check could not be loaded. Check your connection and reload the page.")}</p>}
          {captchaError && !captcha.token && <p className="text-destructive text-xs">{tr("Please confirm you are not a robot.")}</p>}
        </div>
      )}
      <Button type="submit" size="lg" className="w-full sm:w-fit" loading={send.isPending}>
        <SendIcon />
        {tr("Send message")}</Button>
    </form>
  );
}

export function PublicContactPage() {
  const { data: site, isLoading } = useSite();
  const [sent, setSent] = useState(false);
  const coords = mapCoords(site?.school_location);
  const enabled = site?.contact_enabled !== false;
  const items = [
    site?.address && { icon: MapPinIcon, label: tr("Address"), value: site.address, href: coords ? `https://www.google.com/maps?q=${coords}` : undefined },
    site?.phone && { icon: PhoneIcon, label: tr("Phone"), value: site.phone, href: `tel:${site.phone}` },
    site?.email && { icon: MailIcon, label: tr("Email"), value: site.email, href: `mailto:${site.email}` },
    site?.fax && { icon: PrinterIcon, label: tr("Fax"), value: site.fax },
  ].filter(Boolean) as { icon: typeof MailIcon; label: string; value: string; href?: string }[];

  return (
    <>
      <PageHero title={tr("Contact us")} subtitle={tr("Questions about admission, fees or anything else? We are happy to help.")} />
      <Container className={cn("mt-10 grid gap-8", enabled && "lg:grid-cols-[2fr_3fr]")}>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{schoolName(site)}</CardTitle>
              <CardDescription>{tr("Reach the school office")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading && <Skeleton className="h-24 w-full" />}
              {items.map((c) => (
                <div key={c.label} className="flex gap-3">
                  <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
                    <c.icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs font-medium uppercase">{c.label}</p>
                    {c.href ? (
                      <a href={c.href} target={c.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="hover:text-primary font-medium break-words">
                        {c.value}
                      </a>
                    ) : (
                      <p className="font-medium break-words">{c.value}</p>
                    )}
                  </div>
                </div>
              ))}
              {site && items.length === 0 && <p className="text-muted-foreground text-sm">{tr("Contact details have not been published yet.")}</p>}
            </CardContent>
          </Card>
          {coords && (
            <Card className="gap-0 overflow-hidden py-0">
              <iframe
                title={tr("School location")}
                src={`https://maps.google.com/maps?q=${coords}&z=15&output=embed`}
                className="aspect-[4/3] w-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
              <div className="border-t p-3">
                <Button asChild variant="ghost" size="sm">
                  <a href={`https://www.google.com/maps?q=${coords}`} target="_blank" rel="noopener noreferrer">
                    <MapPinIcon />
                    {tr("Open in Google Maps")}</a>
                </Button>
              </div>
            </Card>
          )}
        </div>

        {enabled && (
          <Card>
            {sent ? (
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <span className="bg-success/15 text-success flex size-14 items-center justify-center rounded-full">
                  <CheckIcon className="size-7" />
                </span>
                <h2 className="text-xl font-semibold">{tr("Message sent")}</h2>
                <p className="text-muted-foreground max-w-sm">{tr("Thank you for getting in touch. The school office will reply to you by email as soon as possible.")}</p>
                <Button variant="outline" className="mt-2" onClick={() => setSent(false)}>
                  {tr("Send another message")}</Button>
              </CardContent>
            ) : (
              <>
                <CardHeader>
                  <CardTitle className="text-xl">{tr("Send us a message")}</CardTitle>
                  <CardDescription>{tr("We usually reply within one working day.")}</CardDescription>
                </CardHeader>
                <CardContent>{site ? <ContactForm siteKey={site.recaptcha_site_key || null} onSent={() => setSent(true)} /> : <Skeleton className="h-72 w-full" />}</CardContent>
              </>
            )}
          </Card>
        )}
      </Container>
    </>
  );
}

// --- admission ------------------------------------------------------------------

function Line({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex items-end gap-2 text-sm", className)}>
      <span className="shrink-0 font-medium">{label}:</span>
      <span className="border-foreground/40 h-6 flex-1 border-b border-dashed print:border-black" />
    </div>
  );
}

function Boxes({ label, options }: { label: string; options: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="font-medium">{label}:</span>
      {options.map((o) => (
        <span key={o} className="inline-flex items-center gap-1.5">
          <span className="border-foreground/60 inline-block size-4 rounded-sm border print:border-black" />
          {o}
        </span>
      ))}
    </div>
  );
}

function FormSection({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid space-y-4">
      <h2 className="bg-muted flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold tracking-wide uppercase print:bg-gray-100">
        <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-[11px] print:bg-black print:text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

const DOCUMENTS = [
  tr("Birth certificate (copy)"),
  tr("Two recent passport-size photographs"),
  tr("Previous school report card / transcript"),
  tr("Transfer / leaving certificate"),
  tr("Parent or guardian ID (copy)"),
  tr("Immunisation / medical record"),
];

interface AdmissionOptions {
  open: boolean;
  year: string;
  classes: { class_id: number; name: string }[];
  fee?: string | number | null;
  payment_required?: boolean;
  payment_instructions?: string | null;
}

interface ApplicationValues {
  student_name: string;
  class_id: string;
  date_of_birth: string;
  gender: string;
  previous_school: string;
  guardian_name: string;
  guardian_relation: string;
  guardian_phone: string;
  guardian_email: string;
  address: string;
  notes: string;
  payment_method: string;
  payment_reference: string;
  payment_amount: string;
}

const EMPTY_APPLICATION: ApplicationValues = {
  student_name: "", class_id: "", date_of_birth: "", gender: "", previous_school: "", guardian_name: "",
  guardian_relation: "", guardian_phone: "", guardian_email: "", address: "", notes: "",
  payment_method: "", payment_reference: "", payment_amount: "",
};  // prettier-ignore
const MAX_DOCUMENTS = 5;
const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx";

function OnlineApplicationForm({ options, siteKey }: { options: AdmissionOptions; siteKey: string | null }) {
  const fee = options.fee !== null && options.fee !== undefined && options.fee !== "" ? Number(options.fee) : null;
  const form = useForm<ApplicationValues>({ defaultValues: { ...EMPTY_APPLICATION, payment_amount: fee ? String(fee) : "" } });
  const [docs, setDocs] = useState<{ file: File; label: string }[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  const maxDocs = MAX_DOCUMENTS - (photo ? 1 : 0);
  const [sent, setSent] = useState<string | null>(null);
  const captcha = useRecaptcha(siteKey);
  const [captchaError, setCaptchaError] = useState(false);
  const send = useAction(async (body: FormData) => (await api.post<{ reference: string }>("/public/admissions", body)).data, {
    onSuccess: (r) => setSent(r.reference),
  });
  const { errors } = form.formState;
  const showPayment = fee !== null || !!options.payment_required || !!options.payment_instructions;
  const required = !!options.payment_required;
  const hasReference = !!form.watch("payment_reference").trim();

  const submit = form.handleSubmit((v) => {
    if (siteKey && !captcha.token) {
      setCaptchaError(true);
      return;
    }
    if (!v.payment_reference.trim()) v = { ...v, payment_method: "", payment_amount: "" };
    const body = new FormData();
    Object.entries(v).forEach(([k, value]) => value.trim() && body.append(k, value.trim()));
    if (photo) {
      body.append("files", photo);
      body.append("labels", PHOTO_LABEL);
    }
    docs.forEach((d) => {
      body.append("files", d.file);
      body.append("labels", d.label.trim() || "Document");
    });
    if (siteKey && captcha.token) body.append("recaptcha_token", captcha.token);
    send.mutate(body, { onSettled: captcha.reset });
  });

  if (sent)
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
          <CheckIcon className="size-6" />
        </div>
        <p className="text-lg font-semibold">{tr("Application received")}</p>
        <p className="text-muted-foreground max-w-md text-sm">
          {tr("Your reference is")}{" "}<span className="text-foreground font-mono font-semibold">{sent}</span>{tr(". Keep it: with your phone number it lets you check the status below.")}</p>
      </div>
    );

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("Student's full name")} htmlFor="adm-name" required error={errors.student_name?.message}>
          <Input id="adm-name" aria-invalid={!!errors.student_name} {...form.register("student_name", { required: tr("Please enter the student's name") })} />
        </Field>
        <Field label={tr("Class applying for ({year})", { year: options.year })} htmlFor="adm-class" required error={errors.class_id?.message}>
          <select
            id="adm-class"
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            aria-invalid={!!errors.class_id}
            {...form.register("class_id", { required: tr("Please choose a class") })}
          >
            <option value="">{tr("Choose…")}</option>
            {options.classes.map((c) => (
              <option key={c.class_id} value={c.class_id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label={tr("Date of birth")} htmlFor="adm-dob">
          <Input id="adm-dob" type="date" {...form.register("date_of_birth")} />
        </Field>
        <Field label={tr("Gender")} htmlFor="adm-gender">
          <select id="adm-gender" className="border-input bg-background h-9 rounded-md border px-3 text-sm" {...form.register("gender")}>
            <option value="">—</option>
            <option value="male">{tr("Male")}</option>
            <option value="female">{tr("Female")}</option>
            <option value="other">{tr("Other")}</option>
          </select>
        </Field>
        <Field label={tr("Previous school")} htmlFor="adm-prev" className="sm:col-span-2">
          <Input id="adm-prev" {...form.register("previous_school")} />
        </Field>
        <Field label={tr("Parent / guardian name")} htmlFor="adm-gname" required error={errors.guardian_name?.message}>
          <Input id="adm-gname" autoComplete="name" aria-invalid={!!errors.guardian_name} {...form.register("guardian_name", { required: tr("Please enter a name") })} />
        </Field>
        <Field label={tr("Relation to student")} htmlFor="adm-rel">
          <Input id="adm-rel" placeholder={tr("Mother, father, uncle…")} {...form.register("guardian_relation")} />
        </Field>
        <Field label={tr("Phone")} htmlFor="adm-phone" required error={errors.guardian_phone?.message}>
          <Input
            id="adm-phone"
            type="tel"
            autoComplete="tel"
            aria-invalid={!!errors.guardian_phone}
            {...form.register("guardian_phone", { required: tr("Please enter a phone number"), minLength: { value: 5, message: tr("Phone number is too short") } })}
          />
        </Field>
        <Field label={tr("Email")} htmlFor="adm-email" description={tr("We send the reference and decisions here")} error={errors.guardian_email?.message}>
          <Input
            id="adm-email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.guardian_email}
            {...form.register("guardian_email", { pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: tr("Enter a valid email address") } })}
          />
        </Field>
        <Field label={tr("Home address")} htmlFor="adm-address" className="sm:col-span-2">
          <Textarea id="adm-address" rows={2} {...form.register("address")} />
        </Field>
        <Field label={tr("Anything we should know?")} htmlFor="adm-notes" className="sm:col-span-2">
          <Textarea id="adm-notes" rows={3} {...form.register("notes")} />
        </Field>
      </div>

      {showPayment && (
        <div className="bg-muted/50 grid gap-4 rounded-xl border p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{tr("Application fee")}</p>
              <p className="text-muted-foreground text-xs">{required ? tr("Pay the fee first, then enter the transaction ID below.") : tr("If you have paid the fee, enter the transaction ID below.")}</p>
            </div>
            {fee !== null && <span className="bg-primary text-primary-foreground rounded-full px-3 py-1 text-sm font-semibold tabular-nums">{fee.toLocaleString()}</span>}
          </div>
          {options.payment_instructions && <Prose text={options.payment_instructions} className="bg-background rounded-lg border p-3 text-sm" />}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={tr("Paid with")} htmlFor="adm-pay-method" required={required || hasReference} error={errors.payment_method?.message}>
              <select
                id="adm-pay-method"
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                aria-invalid={!!errors.payment_method}
                {...form.register("payment_method", { validate: (m, all) => !!m || (!required && !all.payment_reference.trim()) || tr("Choose how you paid") })}
              >
                <option value="">{tr("Choose…")}</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label={tr("Transaction ID")} htmlFor="adm-pay-ref" required={required} error={errors.payment_reference?.message}>
              <Input
                id="adm-pay-ref"
                placeholder={tr("e.g. 9AB3CD7EF2")}
                autoComplete="off"
                className="font-mono"
                aria-invalid={!!errors.payment_reference}
                {...form.register("payment_reference", { validate: (r) => !required || !!r.trim() || tr("Enter the transaction ID") })}
              />
            </Field>
            <Field label={tr("Amount paid")} htmlFor="adm-pay-amount">
              <Input id="adm-pay-amount" type="number" min={0} step="0.01" {...form.register("payment_amount")} />
            </Field>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        <div className="bg-muted/50 flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 border-dashed text-center">
          {photoUrl ? <img src={photoUrl} alt={tr("Student photo")} className="size-full object-cover" /> : <ImageIcon className="text-muted-foreground size-8" />}
        </div>
        <div className="grid gap-2">
          <p className="text-sm font-medium">{tr("Student photo")}</p>
          <p className="text-muted-foreground text-xs">{tr("Optional. A recent passport-size photo: JPG, PNG or WebP. It is printed on the admission form.")}</p>
          <div className="flex flex-wrap gap-2">
            <label className="border-input hover:bg-accent inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
              <ImageIcon className="size-4" />
              {photo ? tr("Change photo") : tr("Choose photo")}<input
                type="file"
                hidden
                accept={PHOTO_ACCEPT}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) {
                    setPhoto(file);
                    setDocs((ds) => ds.slice(0, MAX_DOCUMENTS - 1));
                  }
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {photo && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto(null)}>
                {tr("Remove")}</Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium">{tr("Documents")}</p>
        <p className="text-muted-foreground text-xs">{tn("Optional. Up to {MAX_DOCUMENTS} files: PDF, image or Word, each at most 10 MB.", { MAX_DOCUMENTS: maxDocs })}</p>
        {docs.map((d, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={tr("Label for {name}", { name: d.file.name })}
              className="w-56"
              value={d.label}
              placeholder={tr("e.g. Birth certificate")}
              onChange={(e) => setDocs((ds) => ds.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <span className="text-muted-foreground truncate text-sm">{d.file.name}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDocs((ds) => ds.filter((_, j) => j !== i))}>
              {tr("Remove")}</Button>
          </div>
        ))}
        {docs.length < maxDocs && (
          <div>
            <label className="border-input hover:bg-accent inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
              <PaperclipIcon className="size-4" />
              {tr("Attach a document")}<input
                type="file"
                hidden
                accept={DOCUMENT_ACCEPT}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) setDocs((ds) => [...ds, { file, label: "" }]);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        )}
      </div>

      {siteKey && (
        <div className="grid gap-1.5">
          <div ref={captcha.ref} onClick={() => setCaptchaError(false)} />
          {captcha.failed && <p className="text-destructive text-xs">{tr("The spam check could not be loaded. Check your connection and reload the page.")}</p>}
          {captchaError && !captcha.token && <p className="text-destructive text-xs">{tr("Please confirm you are not a robot.")}</p>}
        </div>
      )}
      <Button type="submit" size="lg" className="w-full sm:w-fit" loading={send.isPending}>
        <SendIcon />
        {tr("Submit application")}</Button>
    </form>
  );
}

function AdmissionStatusCheck() {
  const form = useForm<{ reference: string; phone: string }>({ defaultValues: { reference: "", phone: "" } });
  const [result, setResult] = useState<{ reference: string; status_label: string; updated_at: string } | null>(null);
  const check = useAction(async (body: { reference: string; phone: string }) => (await api.post("/public/admissions/status", body)).data, {
    onSuccess: setResult,
  });
  return (
    <form onSubmit={form.handleSubmit((v) => check.mutate({ reference: v.reference.trim(), phone: v.phone.trim() }))} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label={tr("Reference")} htmlFor="adm-ref">
          <Input id="adm-ref" placeholder={tr("A26-1F2E3D")} {...form.register("reference", { required: true })} />
        </Field>
        <Field label={tr("Phone used on the application")} htmlFor="adm-ref-phone">
          <Input id="adm-ref-phone" type="tel" {...form.register("phone", { required: true })} />
        </Field>
        <Button type="submit" variant="outline" loading={check.isPending}>
          <SearchIcon />
          {tr("Check status")}</Button>
      </div>
      {result && (
        <p className="text-sm">
          {tr("Application")}{" "}<span className="font-mono font-semibold">{result.reference}</span>: <Badge>{result.status_label}</Badge>
          <span className="text-muted-foreground ml-2">{tn("updated {dayjs}", { dayjs: dayjs(result.updated_at).format("DD MMM YYYY") })}</span>
        </p>
      )}
    </form>
  );
}

export function PublicAdmissionPage() {
  const { data: site } = useSite();
  const options = useGet<AdmissionOptions>("/public/admissions/options");
  const online = options.data?.open ? options.data : null;
  const name = schoolName(site);
  const year = dayjs().year();
  return (
    <>
      <PageHero
        title={tr("Admission")}
        subtitle={
          online
            ? tr("Applications for {year} are open. Apply online below, or print the form and hand it in at the school office.", { year: online.year })
            : tr("Print the admission form, fill it in by hand and hand it in at the school office together with the listed documents.")
        }
      >
        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="lg" className="bg-gold text-ink hover:bg-gold/90 rounded-full font-semibold" onClick={() => window.print()}>
            <PrinterIcon />
            {tr("Print form")}</Button>
          <Button size="lg" variant="outline" className="rounded-full border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => window.print()}>
            <DownloadIcon />
            {tr("Save as PDF")}</Button>
          <Button asChild size="lg" variant="ghost" className="rounded-full text-white hover:bg-white/10 hover:text-white">
            <Link to="/contact">
              {tr("Questions? Contact us")}<ArrowRightIcon />
            </Link>
          </Button>
        </div>
      </PageHero>

      <Container className="no-print mt-10 max-w-4xl space-y-6">
        {online && (
          <Card>
            <CardHeader>
              <CardTitle>{tr("Apply online")}</CardTitle>
              <CardDescription>{tr("You get a reference number right away. The school office will contact you.")}</CardDescription>
            </CardHeader>
            <CardContent>{site ? <OnlineApplicationForm options={online} siteKey={site.recaptcha_site_key || null} /> : <Skeleton className="h-96 w-full" />}</CardContent>
          </Card>
        )}
        {options.data && !online && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDaysIcon className="text-muted-foreground size-5" />
                {tr("Online applications are closed")}
              </CardTitle>
              <CardDescription>
                {tr("The school is not taking applications online right now. Print the form above and hand it in at the school office, or contact us to ask when applications open.")}
              </CardDescription>
            </CardHeader>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>{tr("Check an application")}</CardTitle>
            <CardDescription>{tr("Enter the reference you received and the phone number given on the application.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <AdmissionStatusCheck />
          </CardContent>
        </Card>
        {online && <h2 className="pt-4 text-xl font-semibold tracking-tight">{tr("Paper form")}</h2>}
      </Container>

      <Container className="mt-6 max-w-4xl print:mt-0 print:max-w-none print:px-0">
        <div className="bg-card space-y-8 rounded-xl border p-6 shadow-sm sm:p-10 print:rounded-none print:border-0 print:p-0 print:text-black print:shadow-none">
          <div className="flex items-start justify-between gap-6 border-b-2 border-current pb-6">
            <div className="flex items-center gap-4">
              {site?.header_logo_url && <img src={site.header_logo_url} alt="" className="h-16 w-auto" />}
              <div>
                <h2 className="text-2xl font-bold tracking-tight">{name}</h2>
                {site?.address && <p className="text-sm">{site.address}</p>}
                <p className="text-sm">{[site?.phone, site?.email].filter(Boolean).join(" · ")}</p>
                <p className="mt-3 text-lg font-semibold tracking-wide uppercase">{tr("Admission form")}</p>
                <p className="text-muted-foreground text-xs print:text-black">
                  {tn("Academic year: {year}–{value}  ·  Form no.: ____________", { year, value: year + 1 })}</p>
              </div>
            </div>
            <div className="border-foreground/50 hidden size-32 shrink-0 flex-col items-center justify-center rounded-md border-2 border-dashed p-2 text-center text-xs sm:flex print:flex print:border-black">
              {tr("Affix passport-size photo")}</div>
          </div>

          <FormSection n={1} title={tr("Student information")}>
            <Line label={tr("Full name (in block letters)")} />
            <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
              <Line label={tr("Date of birth")} />
              <Line label={tr("Place of birth")} />
              <Boxes label={tr("Gender")} options={[tr("Male"), tr("Female"), tr("Other")]} />
              <Line label={tr("Blood group")} />
              <Line label={tr("Religion")} />
              <Line label={tr("Nationality")} />
              <Line label={tr("Class applying for")} />
              <Line label={tr("Preferred section / shift")} />
            </div>
            <Line label={tr("Home address")} />
            <Line label="" className="[&>span:first-child]:invisible" />
            <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
              <Line label={tr("Phone")} />
              <Line label={tr("Email")} />
            </div>
          </FormSection>

          <FormSection n={2} title={tr("Parent / guardian information")}>
            <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
              <Line label={tr("Father's name")} />
              <Line label={tr("Occupation")} />
              <Line label={tr("Mobile")} />
              <Line label={tr("Email")} />
              <Line label={tr("Mother's name")} />
              <Line label={tr("Occupation")} />
              <Line label={tr("Mobile")} />
              <Line label={tr("Email")} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
              <Line label={tr("Guardian (if other than parents)")} />
              <Line label={tr("Relationship")} />
            </div>
            <Line label={tr("Emergency contact (name & phone)")} />
          </FormSection>

          <FormSection n={3} title={tr("Educational background")}>
            <Line label={tr("Previous school")} />
            <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3">
              <Line label={tr("Last class attended")} />
              <Line label={tr("Year")} />
              <Line label={tr("Result / GPA")} />
            </div>
            <Line label={tr("Reason for leaving")} />
            <Line label={tr("Medical conditions / special needs (if any)")} />
          </FormSection>

          <FormSection n={4} title={tr("Documents attached")}>
            <div className="grid gap-2 sm:grid-cols-2 print:grid-cols-2">
              {DOCUMENTS.map((d) => (
                <span key={d} className="inline-flex items-center gap-2 text-sm">
                  <span className="border-foreground/60 inline-block size-4 shrink-0 rounded-sm border print:border-black" />
                  {d}
                </span>
              ))}
            </div>
          </FormSection>

          <FormSection n={5} title={tr("Declaration")}>
            <p className="text-sm leading-relaxed">
              {tn("I declare that the information given above is true and complete. I agree to abide by the rules and regulations of {name}.", { name })}</p>
            <div className="grid gap-8 pt-8 sm:grid-cols-3 print:grid-cols-3">
              {[tr("Signature of parent / guardian"), tr("Signature of student"), tr("Date")].map((s) => (
                <div key={s} className="border-t border-current pt-1 text-center text-xs">
                  {s}
                </div>
              ))}
            </div>
          </FormSection>

          <div className="break-inside-avoid rounded-md border border-dashed p-4 print:border-black">
            <p className="mb-4 text-xs font-bold tracking-wide uppercase">{tr("For office use only")}</p>
            <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3">
              <Line label={tr("Admission no.")} />
              <Line label={tr("Class / section")} />
              <Line label={tr("Roll")} />
              <Line label={tr("Received by")} />
              <Line label={tr("Date")} />
              <Line label={tr("Principal")} />
            </div>
          </div>
        </div>
      </Container>
    </>
  );
}
