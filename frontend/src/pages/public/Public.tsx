import dayjs from "dayjs";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  DownloadIcon,
  ExternalLinkIcon,
  ImageIcon,
  LogInIcon,
  MailIcon,
  MapPinIcon,
  MegaphoneIcon,
  MenuIcon,
  NewspaperIcon,
  PhoneIcon,
  PrinterIcon,
  SendIcon,
  UsersIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, Outlet, useLocation, useParams } from "react-router-dom";

import { api } from "../../api/client";
import { useAction, useGet, usePublicSettings } from "../../api/hooks";
import { EmptyState } from "../../components/states";
import { Field } from "../../components/field";
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
const schoolName = (site: Site | undefined) => site?.school_title || site?.system_name || "School";

const MAIN_LINKS = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About" },
  { to: "/teachers", label: "Teachers" },
];
const LIFE_LINKS = [
  { to: "/notices", label: "Notices", icon: MegaphoneIcon, description: "Announcements from the school office" },
  { to: "/news", label: "News", icon: NewspaperIcon, description: "Stories and updates from campus" },
  { to: "/events", label: "Events", icon: CalendarDaysIcon, description: "What is happening and when" },
  { to: "/gallery", label: "Gallery", icon: ImageIcon, description: "Photos from school life" },
];
const END_LINKS = [
  { to: "/admission", label: "Admission" },
  { to: "/contact", label: "Contact" },
];
const ALL_LINKS = [...MAIN_LINKS, ...LIFE_LINKS, ...END_LINKS];

const SOCIAL_LABEL: Record<string, string> = {
  facebook: "Facebook",
  twitter: "X / Twitter",
  google: "Google",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
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

function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: { to: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="text-primary mb-1 text-xs font-semibold tracking-widest uppercase">{eyebrow}</p>}
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      </div>
      {action && (
        <Button asChild variant="ghost" size="sm">
          <Link to={action.to}>
            {action.label}
            <ArrowRightIcon />
          </Link>
        </Button>
      )}
    </div>
  );
}

/** Title band at the top of inner pages; the "ultimate" theme uses the brand colour. */
function PageHero({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  const { data: site } = useSite();
  const ultimate = site?.theme === "ultimate";
  return (
    <div className={cn("no-print border-b", ultimate ? "bg-primary text-primary-foreground" : "bg-muted/50")}>
      <Container className="py-10 sm:py-14">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className={cn("mt-2 max-w-2xl", ultimate ? "text-primary-foreground/80" : "text-muted-foreground")}>{subtitle}</p>}
        {children}
      </Container>
    </div>
  );
}

function useActive() {
  const { pathname } = useLocation();
  return (to: string) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`));
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
      <NavigationMenuLink asChild active={isActive(to)} className={cn(navigationMenuTriggerStyle(), "flex-row bg-transparent data-[active=true]:text-primary")}>
        <Link to={to}>{label}</Link>
      </NavigationMenuLink>
    </NavigationMenuItem>
  );

  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col">
      <header className="bg-background/90 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-40 border-b backdrop-blur">
        <Container className="flex h-16 items-center justify-between gap-4">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            {site?.header_logo_url ? (
              <img src={site.header_logo_url} alt="" className="h-10 w-auto shrink-0" />
            ) : (
              <span className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold">{initials(name)}</span>
            )}
            <span className="truncate text-base font-bold tracking-tight sm:text-lg">{name}</span>
          </Link>

          <NavigationMenu viewport={false} className="hidden lg:flex">
            <NavigationMenuList>
              {MAIN_LINKS.map((l) => navLink(l.to, l.label))}
              <NavigationMenuItem>
                <NavigationMenuTrigger className={cn("bg-transparent", LIFE_LINKS.some((l) => isActive(l.to)) && "text-primary")}>School life</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid w-[30rem] grid-cols-2 gap-1 p-1">
                    {LIFE_LINKS.map((l) => (
                      <li key={l.to}>
                        <NavigationMenuLink asChild active={isActive(l.to)}>
                          <Link to={l.to} className="flex-row items-start gap-3">
                            <l.icon className="text-primary! mt-0.5 size-5!" />
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
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link to="/login">
                <LogInIcon />
                Portal login
              </Link>
            </Button>
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                  <MenuIcon />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xs">
                <SheetHeader>
                  <SheetTitle>{name}</SheetTitle>
                </SheetHeader>
                <nav className="grid gap-1 px-4">
                  {ALL_LINKS.map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      className={cn(
                        "hover:bg-accent rounded-md px-3 py-2.5 text-base font-medium transition-colors",
                        isActive(l.to) && "bg-accent text-primary",
                      )}
                    >
                      {l.label}
                    </Link>
                  ))}
                </nav>
                <div className="mt-4 grid gap-2 px-4 pb-6">
                  <Button asChild>
                    <Link to="/login">
                      <LogInIcon />
                      Portal login
                    </Link>
                  </Button>
                  {site?.phone && (
                    <Button asChild variant="outline">
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

      <footer className="no-print mt-16 bg-zinc-950 text-zinc-400">
        <Container className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {site?.footer_logo_url ? (
                <img src={site.footer_logo_url} alt="" className="h-10 w-auto" />
              ) : (
                <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-lg text-sm font-bold">{initials(name)}</span>
              )}
              <span className="font-bold text-white">{name}</span>
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
                    className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                  >
                    {SOCIAL_LABEL[k] ?? k}
                  </a>
                ))}
              </div>
            )}
          </div>
          <FooterLinks title="School" links={[...MAIN_LINKS.slice(1), ...END_LINKS, { to: "/login", label: "Portal login" }]} />
          <FooterLinks title="School life" links={LIFE_LINKS} />
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white">Get in touch</h3>
            <ul className="space-y-2.5 text-sm">
              {site?.address && (
                <li className="flex gap-2">
                  <MapPinIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{site.address}</span>
                </li>
              )}
              {site?.phone && (
                <li className="flex gap-2">
                  <PhoneIcon className="mt-0.5 size-4 shrink-0" />
                  <a href={`tel:${site.phone}`} className="hover:text-white">
                    {site.phone}
                  </a>
                </li>
              )}
              {site?.email && (
                <li className="flex gap-2">
                  <MailIcon className="mt-0.5 size-4 shrink-0" />
                  <a href={`mailto:${site.email}`} className="break-all hover:text-white">
                    {site.email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </Container>
        <div className="border-t border-zinc-800">
          <Container className="flex flex-col gap-2 py-5 text-xs sm:flex-row sm:items-center sm:justify-between">
            <p>{site?.copyright_text || `© ${new Date().getFullYear()} ${name}. All rights reserved.`}</p>
            <div className="flex gap-4">
              <Link to="/terms" className="hover:text-white">
                Terms & conditions
              </Link>
              <Link to="/privacy" className="hover:text-white">
                Privacy policy
              </Link>
            </div>
          </Container>
        </div>
      </footer>
    </div>
  );
}

function FooterLinks({ title, links }: { title: string; links: { to: string; label: string }[] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <ul className="space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="transition-colors hover:text-white">
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
      <Card className="h-full gap-0 overflow-hidden py-0 transition-shadow group-hover:shadow-md">
        <div className="bg-muted aspect-video overflow-hidden">
          {n.image_url ? (
            <img src={n.image_url} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : (
            <div className="text-muted-foreground flex size-full items-center justify-center">
              <NewspaperIcon className="size-8" />
            </div>
          )}
        </div>
        <CardContent className="space-y-2 p-5">
          <p className="text-muted-foreground text-xs">{fromUnix(n.date_added)}</p>
          <h3 className="group-hover:text-primary line-clamp-2 font-semibold transition-colors">{n.title}</h3>
          <p className="text-muted-foreground line-clamp-3 text-sm">{n.description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function DateTile({ ts, className }: { ts: number | string; className?: string }) {
  return (
    <div className={cn("bg-primary/10 text-primary flex w-16 shrink-0 flex-col items-center justify-center rounded-lg py-2", className)}>
      <span className="text-2xl leading-none font-bold">{fromUnix(ts, "DD")}</span>
      <span className="mt-1 text-[11px] font-medium uppercase">{fromUnix(ts, "MMM YY")}</span>
    </div>
  );
}

function TeacherCard({ t }: { t: TeacherItem }) {
  const social = validSocial(t.social_links);
  return (
    <Card className="gap-0 overflow-hidden py-0 text-center">
      <div className="bg-muted aspect-square overflow-hidden">
        {t.image_url ? (
          <img src={t.image_url} alt={t.name} className="size-full object-cover" />
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center text-3xl font-semibold">{initials(t.name)}</div>
        )}
      </div>
      <CardContent className="space-y-1 p-5">
        <h3 className="font-semibold">{t.name}</h3>
        {t.designation && <p className="text-primary text-sm">{t.designation}</p>}
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

function GalleryCard({ g }: { g: GalleryItem }) {
  return (
    <Link to={`/gallery/${g.frontend_gallery_id}`} className="group relative block overflow-hidden rounded-xl">
      <div className="bg-muted aspect-[4/3]">
        {g.image_url && <img src={g.image_url} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pt-12 text-white">
        <h3 className="font-semibold">{g.title}</h3>
        {g.description && <p className="line-clamp-1 text-sm text-white/80">{g.description}</p>}
      </div>
    </Link>
  );
}

function GridSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-6 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="aspect-[4/3] w-full rounded-xl" />
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
  const description = slide?.description || site?.homepage_note_title || `Welcome to ${name}`;
  const ultimate = site?.theme === "ultimate";
  const go = (step: number) => setIndex((i) => (i + step + slides.length) % slides.length);

  const ctas = (
    <div className="mt-8 flex flex-wrap gap-3">
      <Button asChild size="lg" variant={ultimate ? "secondary" : "default"}>
        <Link to="/admission">
          <ClipboardListIcon />
          Admission
        </Link>
      </Button>
      <Button
        asChild
        size="lg"
        variant="outline"
        className="border-white/40 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white"
      >
        <Link to="/contact">
          <MailIcon />
          Contact us
        </Link>
      </Button>
      <Button asChild size="lg" variant="ghost" className="text-white hover:bg-white/10 hover:text-white">
        <Link to="/login">
          <LogInIcon />
          Portal login
        </Link>
      </Button>
    </div>
  );
  const dots = slides.length > 1 && (
    <div className="flex items-center gap-2">
      {slides.map((_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Slide ${i + 1}`}
          onClick={() => setIndex(i)}
          className={cn("h-1.5 rounded-full bg-white/50 transition-all", i === index % slides.length ? "w-8 bg-white" : "w-3")}
        />
      ))}
    </div>
  );
  const images = slides.map((s, i) => (
    <img
      key={s.image_url}
      src={s.image_url!}
      alt=""
      className={cn("absolute inset-0 size-full object-cover transition-opacity duration-1000", i === index % slides.length ? "opacity-100" : "opacity-0")}
    />
  ));

  if (ultimate)
    return (
      <section className="bg-primary text-primary-foreground">
        <Container className="grid items-center gap-10 py-12 lg:grid-cols-2 lg:py-20">
          <div>
            <p className="text-primary-foreground/70 mb-3 text-sm font-semibold tracking-widest uppercase">{name}</p>
            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">{title}</h1>
            <p className="text-primary-foreground/80 mt-4 max-w-xl text-lg">{description}</p>
            {ctas}
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-white/10 shadow-2xl ring-1 ring-white/20">
            {images}
            {slides.length > 1 && <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/50 to-transparent p-4">{dots}</div>}
          </div>
        </Container>
      </section>
    );

  return (
    <section className="bg-primary relative isolate overflow-hidden text-white">
      {images}
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/20" />
      <Container className="relative flex min-h-[28rem] flex-col justify-center py-20 sm:min-h-[34rem]">
        <p className="mb-3 text-sm font-semibold tracking-widest text-white/70 uppercase">{name}</p>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">{title}</h1>
        <p className="mt-4 max-w-2xl text-lg text-white/80">{description}</p>
        {ctas}
        {slides.length > 1 && (
          <div className="mt-10 flex items-center gap-4">
            <button type="button" aria-label="Previous slide" onClick={() => go(-1)} className="rounded-full border border-white/30 p-2 hover:bg-white/10">
              <ChevronLeftIcon className="size-4" />
            </button>
            {dots}
            <button type="button" aria-label="Next slide" onClick={() => go(1)} className="rounded-full border border-white/30 p-2 hover:bg-white/10">
              <ChevronRightIcon className="size-4" />
            </button>
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
    site?.address && { icon: MapPinIcon, label: "Visit us", value: site.address },
    site?.phone && { icon: PhoneIcon, label: "Call us", value: site.phone, href: `tel:${site.phone}` },
    site?.email && { icon: MailIcon, label: "Email us", value: site.email, href: `mailto:${site.email}` },
  ].filter(Boolean) as { icon: typeof MailIcon; label: string; value: string; href?: string }[];

  return (
    <>
      <HeroSlider site={site} />

      {contacts.length > 0 && (
        <Container className="relative z-10 -mt-10">
          <div className="bg-card grid divide-y rounded-xl border shadow-lg sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {contacts.map((c) => (
              <div key={c.label} className="flex items-center gap-4 p-5">
                <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-full">
                  <c.icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs font-medium uppercase">{c.label}</p>
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

      {(site?.homepage_note_title || site?.about_us) && (
        <Container className="mt-20 grid items-center gap-10 lg:grid-cols-2">
          <div className="bg-muted aspect-[4/3] overflow-hidden rounded-2xl">
            {site?.about_us_image_url ? (
              <img src={site.about_us_image_url} alt="" className="size-full object-cover" />
            ) : (
              <div className="text-muted-foreground flex size-full items-center justify-center">
                <UsersIcon className="size-12" />
              </div>
            )}
          </div>
          <div>
            <p className="text-primary mb-1 text-xs font-semibold tracking-widest uppercase">About us</p>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{site?.homepage_note_title || `Welcome to ${schoolName(site)}`}</h2>
            <Prose text={site?.homepage_note_description || site?.about_us} className="text-muted-foreground mt-4 line-clamp-[10]" />
            <Button asChild variant="outline" className="mt-6">
              <Link to="/about">
                Learn more
                <ArrowRightIcon />
              </Link>
            </Button>
          </div>
        </Container>
      )}

      <Container className="mt-20 grid gap-8 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-lg">
                <MegaphoneIcon className="text-primary size-5" />
                Latest notices
              </CardTitle>
              <CardDescription>Announcements from the school office</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/notices">
                View all
                <ArrowRightIcon />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {notices.isLoading && <Skeleton className="h-40 w-full" />}
            {notices.data?.length === 0 && <p className="text-muted-foreground text-sm">No notices at the moment.</p>}
            <ul className="divide-y">
              {notices.data?.slice(0, 5).map((n) => (
                <li key={n.notice_id}>
                  <Link to={`/notices/${n.notice_id}`} className="group flex items-start justify-between gap-4 py-3">
                    <span className="group-hover:text-primary font-medium transition-colors">{n.notice_title}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">{fromUnix(n.create_timestamp)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarDaysIcon className="text-primary size-5" />
                Events
              </CardTitle>
              <CardDescription>Dates for your calendar</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/events">
                View all
                <ArrowRightIcon />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {events.isLoading && <Skeleton className="h-40 w-full" />}
            {events.data?.length === 0 && <p className="text-muted-foreground text-sm">No events scheduled.</p>}
            <ul className="space-y-3">
              {events.data?.slice(0, 4).map((e) => (
                <li key={e.frontend_events_id} className="flex items-center gap-4">
                  <DateTile ts={e.timestamp} />
                  <div className="min-w-0">
                    <p className="font-medium">{e.title}</p>
                    <p className="text-muted-foreground text-xs">{e.timestamp >= today ? "Upcoming" : "Past"} · {fromUnix(e.timestamp, "dddd")}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </Container>

      <Container className="mt-20">
        <SectionHeading eyebrow="Stay informed" title="Latest news" action={{ to: "/news", label: "All news" }} />
        {news.isLoading && <GridSkeleton />}
        {news.data?.length === 0 && <EmptyState icon={NewspaperIcon} title="No news yet" />}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {news.data?.map((n) => (
            <NewsCard key={n.frontend_news_id} n={n} />
          ))}
        </div>
      </Container>

      {!!teachers.data?.length && (
        <Container className="mt-20">
          <SectionHeading eyebrow="Our people" title="Meet our teachers" action={{ to: "/teachers", label: "All teachers" }} />
          <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
            {teachers.data.slice(0, 4).map((t) => (
              <TeacherCard key={t.teacher_id} t={t} />
            ))}
          </div>
        </Container>
      )}

      {!!gallery.data?.length && (
        <Container className="mt-20">
          <SectionHeading eyebrow="School life" title="Gallery" action={{ to: "/gallery", label: "All albums" }} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.data.slice(0, 6).map((g) => (
              <GalleryCard key={g.frontend_gallery_id} g={g} />
            ))}
          </div>
        </Container>
      )}

      <Container className="mt-20">
        <div className="bg-primary text-primary-foreground relative overflow-hidden rounded-2xl px-6 py-12 sm:px-12">
          <div className="absolute -top-16 -right-16 size-64 rounded-full bg-white/10" />
          <div className="absolute -bottom-24 left-1/3 size-48 rounded-full bg-white/5" />
          <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Admissions are open</h2>
              <p className="text-primary-foreground/80 mt-2 max-w-xl">
                Download the admission form, fill it in and bring it to the school office, or get in touch with any questions.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" variant="secondary">
                <Link to="/admission">
                  <ClipboardListIcon />
                  Admission form
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="hover:text-primary-foreground hover:bg-white/10">
                <Link to="/contact">
                  Contact us
                  <ArrowRightIcon />
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
      <PageHero title="Noticeboard" subtitle="Official announcements from the school" />
      <Container className="mt-10 max-w-4xl space-y-4">
        {isLoading && <Skeleton className="h-28 w-full" />}
        {data?.length === 0 && <EmptyState icon={MegaphoneIcon} title="No notices" />}
        {data?.map((n) => (
          <Link key={n.notice_id} to={`/notices/${n.notice_id}`} className="group block">
            <Card className="flex-row items-start gap-4 p-5 transition-shadow group-hover:shadow-md">
              <DateTile ts={n.create_timestamp} />
              <div className="min-w-0 space-y-1">
                <h2 className="group-hover:text-primary font-semibold transition-colors">{n.notice_title}</h2>
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
    <Container className="mt-10 max-w-3xl">
      <BackLink to="/notices" label="All notices" />
      <Badge variant="secondary" className="mb-3">
        <MegaphoneIcon />
        Notice
      </Badge>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{data.notice_title}</h1>
      <p className="text-muted-foreground mt-2 mb-8">{fromUnix(data.create_timestamp, "dddd, DD MMMM YYYY")}</p>
      {data.image_url && <img src={data.image_url} alt="" className="mb-8 w-full rounded-xl" />}
      <Prose text={data.notice} className="text-lg" />
    </Container>
  );
}

export function PublicNewsPage() {
  const { data, isLoading } = useGet<NewsItem[]>("/public/news", { limit: 50 });
  return (
    <>
      <PageHero title="News" subtitle="Stories and updates from our school community" />
      <Container className="mt-10">
        {isLoading && <GridSkeleton count={6} />}
        {data?.length === 0 && <EmptyState icon={NewspaperIcon} title="No news yet" />}
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
    <Container className="mt-10 max-w-3xl">
      <BackLink to="/news" label="All news" />
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{data.title}</h1>
      <p className="text-muted-foreground mt-2 mb-8">{fromUnix(data.date_added, "dddd, DD MMMM YYYY")}</p>
      {data.image_url && <img src={data.image_url} alt="" className="mb-8 w-full rounded-xl" />}
      <Prose text={data.description} className="text-lg" />
    </Container>
  );
}

export function PublicEventsPage() {
  const { data, isLoading } = useGet<EventItem[]>("/public/events");
  const today = dayjs().startOf("day").unix();
  return (
    <>
      <PageHero title="Events" subtitle="Important dates in the school calendar" />
      <Container className="mt-10 max-w-4xl space-y-3">
        {isLoading && <Skeleton className="h-24 w-full" />}
        {data?.length === 0 && <EmptyState icon={CalendarDaysIcon} title="No events" />}
        {data?.map((e) => (
          <Card key={e.frontend_events_id} className="flex-row items-center gap-4 p-4">
            <DateTile ts={e.timestamp} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{e.title}</p>
              <p className="text-muted-foreground text-sm">{fromUnix(e.timestamp, "dddd, DD MMMM YYYY")}</p>
            </div>
            {e.timestamp >= today ? (
              <Badge className="bg-success/15 text-success border-transparent">Upcoming</Badge>
            ) : (
              <Badge variant="secondary">Past</Badge>
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
      <PageHero title="Gallery" subtitle="Moments from school life" />
      <Container className="mt-10">
        {isLoading && <GridSkeleton count={6} />}
        {data?.length === 0 && <EmptyState icon={ImageIcon} title="No albums yet" />}
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
        <p className="mt-3 text-sm opacity-70">{data.images.length} photos</p>
      </PageHero>
      <Container className="mt-10">
        <BackLink to="/gallery" label="All albums" />
        {data.images.length === 0 && <EmptyState icon={ImageIcon} title="No photos in this album yet" />}
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
            <Button variant="outline" size="icon-sm" aria-label="Previous photo" onClick={() => step(-1)}>
              <ChevronLeftIcon />
            </Button>
            <span className="text-muted-foreground truncate text-sm">
              {current?.title || `${(open ?? 0) + 1} / ${data.images.length}`}
            </span>
            <div className="flex gap-2">
              {current && (
                <Button asChild variant="outline" size="icon-sm" aria-label="Open original">
                  <a href={current.image_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLinkIcon />
                  </a>
                </Button>
              )}
              <Button variant="outline" size="icon-sm" aria-label="Next photo" onClick={() => step(1)}>
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
      <PageHero title="Our teachers" subtitle="The dedicated people who make learning happen" />
      <Container className="mt-10">
        {isLoading && <GridSkeleton count={4} className="lg:grid-cols-4" />}
        {data?.length === 0 && <EmptyState icon={UsersIcon} title="No teachers listed yet" />}
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
          {site && (site[field] ? <Prose text={site[field]} className="text-lg" /> : <p className="text-muted-foreground">Nothing here yet.</p>)}
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
      reject(new Error("reCAPTCHA failed to load"));
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
        <Field label="Your name" htmlFor="contact-name" required error={errors.name?.message}>
          <Input id="contact-name" autoComplete="name" aria-invalid={!!errors.name} {...form.register("name", { required: "Please enter your name" })} />
        </Field>
        <Field label="Email" htmlFor="contact-email" required error={errors.email?.message}>
          <Input
            id="contact-email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...form.register("email", { required: "Please enter your email", pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email address" } })}
          />
        </Field>
      </div>
      <Field label="Phone" htmlFor="contact-phone" description="Optional">
        <Input id="contact-phone" type="tel" autoComplete="tel" {...form.register("phone")} />
      </Field>
      <Field label="Message" htmlFor="contact-message" required error={errors.message?.message}>
        <Textarea
          id="contact-message"
          rows={6}
          aria-invalid={!!errors.message}
          {...form.register("message", { required: "Please write a message", minLength: { value: 10, message: "Message is too short" } })}
        />
      </Field>
      {siteKey && (
        <div className="grid gap-1.5">
          <div ref={captcha.ref} onClick={() => setCaptchaError(false)} />
          {captcha.failed && <p className="text-destructive text-xs">The spam check could not be loaded. Check your connection and reload the page.</p>}
          {captchaError && !captcha.token && <p className="text-destructive text-xs">Please confirm you are not a robot.</p>}
        </div>
      )}
      <Button type="submit" size="lg" className="w-full sm:w-fit" loading={send.isPending}>
        <SendIcon />
        Send message
      </Button>
    </form>
  );
}

export function PublicContactPage() {
  const { data: site, isLoading } = useSite();
  const [sent, setSent] = useState(false);
  const coords = mapCoords(site?.school_location);
  const enabled = site?.contact_enabled !== false;
  const items = [
    site?.address && { icon: MapPinIcon, label: "Address", value: site.address, href: coords ? `https://www.google.com/maps?q=${coords}` : undefined },
    site?.phone && { icon: PhoneIcon, label: "Phone", value: site.phone, href: `tel:${site.phone}` },
    site?.email && { icon: MailIcon, label: "Email", value: site.email, href: `mailto:${site.email}` },
    site?.fax && { icon: PrinterIcon, label: "Fax", value: site.fax },
  ].filter(Boolean) as { icon: typeof MailIcon; label: string; value: string; href?: string }[];

  return (
    <>
      <PageHero title="Contact us" subtitle="Questions about admission, fees or anything else? We are happy to help." />
      <Container className={cn("mt-10 grid gap-8", enabled && "lg:grid-cols-[2fr_3fr]")}>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{schoolName(site)}</CardTitle>
              <CardDescription>Reach the school office</CardDescription>
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
              {site && items.length === 0 && <p className="text-muted-foreground text-sm">Contact details have not been published yet.</p>}
            </CardContent>
          </Card>
          {coords && (
            <Card className="gap-0 overflow-hidden py-0">
              <iframe
                title="School location"
                src={`https://maps.google.com/maps?q=${coords}&z=15&output=embed`}
                className="aspect-[4/3] w-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
              <div className="border-t p-3">
                <Button asChild variant="ghost" size="sm">
                  <a href={`https://www.google.com/maps?q=${coords}`} target="_blank" rel="noopener noreferrer">
                    <MapPinIcon />
                    Open in Google Maps
                  </a>
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
                <h2 className="text-xl font-semibold">Message sent</h2>
                <p className="text-muted-foreground max-w-sm">Thank you for getting in touch. The school office will reply to you by email as soon as possible.</p>
                <Button variant="outline" className="mt-2" onClick={() => setSent(false)}>
                  Send another message
                </Button>
              </CardContent>
            ) : (
              <>
                <CardHeader>
                  <CardTitle className="text-xl">Send us a message</CardTitle>
                  <CardDescription>We usually reply within one working day.</CardDescription>
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
  "Birth certificate (copy)",
  "Two recent passport-size photographs",
  "Previous school report card / transcript",
  "Transfer / leaving certificate",
  "Parent or guardian ID (copy)",
  "Immunisation / medical record",
];

export function PublicAdmissionPage() {
  const { data: site } = useSite();
  const name = schoolName(site);
  const year = dayjs().year();
  return (
    <>
      <PageHero title="Admission" subtitle="Print the admission form, fill it in by hand and hand it in at the school office together with the listed documents.">
        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="lg" variant={site?.theme === "ultimate" ? "secondary" : "default"} onClick={() => window.print()}>
            <PrinterIcon />
            Print form
          </Button>
          <Button size="lg" variant="outline" className="bg-background text-foreground" onClick={() => window.print()}>
            <DownloadIcon />
            Save as PDF
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link to="/contact">
              Questions? Contact us
              <ArrowRightIcon />
            </Link>
          </Button>
        </div>
      </PageHero>

      <Container className="mt-10 max-w-4xl print:mt-0 print:max-w-none print:px-0">
        <div className="bg-card space-y-8 rounded-xl border p-6 shadow-sm sm:p-10 print:rounded-none print:border-0 print:p-0 print:text-black print:shadow-none">
          <div className="flex items-start justify-between gap-6 border-b-2 border-current pb-6">
            <div className="flex items-center gap-4">
              {site?.header_logo_url && <img src={site.header_logo_url} alt="" className="h-16 w-auto" />}
              <div>
                <h2 className="text-2xl font-bold tracking-tight">{name}</h2>
                {site?.address && <p className="text-sm">{site.address}</p>}
                <p className="text-sm">{[site?.phone, site?.email].filter(Boolean).join(" · ")}</p>
                <p className="mt-3 text-lg font-semibold tracking-wide uppercase">Admission form</p>
                <p className="text-muted-foreground text-xs print:text-black">
                  Academic year: {year}–{year + 1} &nbsp;·&nbsp; Form no.: ____________
                </p>
              </div>
            </div>
            <div className="border-foreground/50 hidden size-32 shrink-0 flex-col items-center justify-center rounded-md border-2 border-dashed p-2 text-center text-xs sm:flex print:flex print:border-black">
              Affix passport-size photo
            </div>
          </div>

          <FormSection n={1} title="Student information">
            <Line label="Full name (in block letters)" />
            <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
              <Line label="Date of birth" />
              <Line label="Place of birth" />
              <Boxes label="Gender" options={["Male", "Female", "Other"]} />
              <Line label="Blood group" />
              <Line label="Religion" />
              <Line label="Nationality" />
              <Line label="Class applying for" />
              <Line label="Preferred section / shift" />
            </div>
            <Line label="Home address" />
            <Line label="" className="[&>span:first-child]:invisible" />
            <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
              <Line label="Phone" />
              <Line label="Email" />
            </div>
          </FormSection>

          <FormSection n={2} title="Parent / guardian information">
            <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
              <Line label="Father's name" />
              <Line label="Occupation" />
              <Line label="Mobile" />
              <Line label="Email" />
              <Line label="Mother's name" />
              <Line label="Occupation" />
              <Line label="Mobile" />
              <Line label="Email" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
              <Line label="Guardian (if other than parents)" />
              <Line label="Relationship" />
            </div>
            <Line label="Emergency contact (name & phone)" />
          </FormSection>

          <FormSection n={3} title="Educational background">
            <Line label="Previous school" />
            <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3">
              <Line label="Last class attended" />
              <Line label="Year" />
              <Line label="Result / GPA" />
            </div>
            <Line label="Reason for leaving" />
            <Line label="Medical conditions / special needs (if any)" />
          </FormSection>

          <FormSection n={4} title="Documents attached">
            <div className="grid gap-2 sm:grid-cols-2 print:grid-cols-2">
              {DOCUMENTS.map((d) => (
                <span key={d} className="inline-flex items-center gap-2 text-sm">
                  <span className="border-foreground/60 inline-block size-4 shrink-0 rounded-sm border print:border-black" />
                  {d}
                </span>
              ))}
            </div>
          </FormSection>

          <FormSection n={5} title="Declaration">
            <p className="text-sm leading-relaxed">
              I declare that the information given above is true and complete. I agree to abide by the rules and regulations of {name}.
            </p>
            <div className="grid gap-8 pt-8 sm:grid-cols-3 print:grid-cols-3">
              {["Signature of parent / guardian", "Signature of student", "Date"].map((s) => (
                <div key={s} className="border-t border-current pt-1 text-center text-xs">
                  {s}
                </div>
              ))}
            </div>
          </FormSection>

          <div className="break-inside-avoid rounded-md border border-dashed p-4 print:border-black">
            <p className="mb-4 text-xs font-bold tracking-wide uppercase">For office use only</p>
            <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3">
              <Line label="Admission no." />
              <Line label="Class / section" />
              <Line label="Roll" />
              <Line label="Received by" />
              <Line label="Date" />
              <Line label="Principal" />
            </div>
          </div>
        </div>
      </Container>
    </>
  );
}
