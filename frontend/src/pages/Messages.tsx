import { useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
  ArrowLeftIcon,
  MessageSquarePlusIcon,
  MessagesSquareIcon,
  PaperclipIcon,
  PencilIcon,
  SearchIcon,
  SendIcon,
  Trash2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { api } from "../api/client";
import { useAction, useGet } from "../api/hooks";
import type { ChatMessage, Contact, Group as ChatGroup, Thread } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox, MultiCombobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { Field } from "../components/field";
import { FileButton } from "../components/file-button";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/states";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import { fromUnix, initials, titleCase } from "../utils";

type Active = { kind: "thread" | "group"; code: string; title: string } | null;

const contactOptions = (contacts: Contact[]) => contacts.map((c) => ({ value: c.ref, label: `${c.name} (${titleCase(c.role)})` }));

function shortTime(ts: string | null | undefined) {
  const n = Number(ts);
  if (!n) return "";
  const d = dayjs.unix(n);
  if (d.isSame(dayjs(), "day")) return d.format("HH:mm");
  if (d.isSame(dayjs(), "year")) return d.format("DD MMM");
  return d.format("DD MMM YY");
}

function dayLabel(ts: string | null) {
  const d = dayjs.unix(Number(ts));
  if (d.isSame(dayjs(), "day")) return "Today";
  if (d.isSame(dayjs().subtract(1, "day"), "day")) return "Yesterday";
  return d.format("dddd, DD MMM YYYY");
}

function ChatAvatar({ name, group, className }: { name: string; group?: boolean; className?: string }) {
  return (
    <Avatar className={cn("size-9", className)}>
      <AvatarFallback className={cn("text-xs font-medium", group ? "bg-primary/10 text-primary" : "bg-muted")}>
        {group ? <UsersIcon className="size-4" /> : initials(name) || "?"}
      </AvatarFallback>
    </Avatar>
  );
}

// --- conversation -------------------------------------------------------------

function Conversation({ active, group, isAdmin, onBack, onEdit, onDeleted }: {
  active: NonNullable<Active>;
  group?: ChatGroup;
  isAdmin: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {  // prettier-ignore
  const path = active.kind === "thread" ? `/messages/threads/${active.code}` : `/groups/${active.code}/messages`;
  const { data, isLoading } = useGet<ChatMessage[]>(path);
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [data]);
  // opening a thread marks it read on the server; refresh the unread counts once
  const refreshed = useRef(false);
  useEffect(() => {
    if (data && active.kind === "thread" && !refreshed.current) {
      refreshed.current = true;
      qc.invalidateQueries({ queryKey: ["/messages/threads"] });
    }
  }, [data, active.kind, qc]);

  const send = useAction(
    () => {
      const body = new FormData();
      body.append("message", text);
      if (file) body.append("file", file);
      return api.post(path, body);
    },
    {
      invalidate: [[path], ["/messages/threads"], ["/groups"]],
      onSuccess: () => {
        setText("");
        setFile(null);
      },
    },
  );
  const remove = useAction(() => api.delete(`/groups/${active.code}`), { success: "Group deleted", invalidate: [["/groups"]], onSuccess: onDeleted });
  const title = group?.group_name ?? active.title;
  const submit = () => {
    if (text.trim() && !send.isPending) send.mutate(undefined);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-3 py-2.5">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeftIcon />
        </Button>
        <ChatAvatar name={title} group={active.kind === "group"} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{title}</div>
          {group && <div className="text-muted-foreground truncate text-xs">{group.members.length} members</div>}
        </div>
        {group && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setMembersOpen(true)}>
              <UsersIcon />
              <span className="hidden sm:inline">Members</span>
            </Button>
            {isAdmin && (
              <>
                <IconAction label="Edit group" onClick={onEdit}><PencilIcon /></IconAction>
                <IconAction
                  label="Delete group"
                  destructive
                  loading={remove.isPending}
                  onClick={() => confirmAction({ title: `Delete "${title}"?`, description: "The group and all its messages are removed for every member.", onConfirm: () => remove.mutate(undefined) })}
                >
                  <Trash2Icon />
                </IconAction>
              </>
            )}
          </div>
        )}
      </div>

      <div ref={scroller} className="bg-muted/30 min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-2/3 rounded-2xl" />
            <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
            <Skeleton className="h-12 w-3/5 rounded-2xl" />
          </div>
        ) : data?.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">No messages yet. Say hello!</div>
        ) : (
          <div className="space-y-2">
            {data?.map((m, i) => {
              const prev = data[i - 1];
              const newDay = !prev || !dayjs.unix(Number(prev.timestamp)).isSame(dayjs.unix(Number(m.timestamp)), "day");
              const showSender = active.kind === "group" && !m.mine && (newDay || prev?.sender !== m.sender);
              return (
                <div key={m.message_id}>
                  {newDay && m.timestamp && (
                    <div className="my-3 flex justify-center">
                      <span className="bg-background text-muted-foreground rounded-full border px-3 py-0.5 text-xs">{dayLabel(m.timestamp)}</span>
                    </div>
                  )}
                  <div className={cn("flex items-end gap-2", m.mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-xs sm:max-w-[70%]",
                        m.mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-background rounded-bl-sm border",
                      )}
                    >
                      {showSender && <div className="text-primary mb-0.5 text-xs font-semibold">{m.sender_name}</div>}
                      {m.message && <div className="break-words whitespace-pre-wrap">{m.message}</div>}
                      {m.attachment_url && (
                        <a
                          href={m.attachment_url}
                          target="_blank"
                          rel="noopener"
                          className={cn(
                            "mt-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs underline-offset-2 hover:underline",
                            m.mine ? "bg-primary-foreground/15" : "bg-muted",
                          )}
                        >
                          <PaperclipIcon className="size-3.5 shrink-0" />
                          <span className="truncate">{m.attachment_name ?? "Attachment"}</span>
                        </a>
                      )}
                      <div className={cn("mt-0.5 text-right text-[10px]", m.mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                        {fromUnix(m.timestamp, "HH:mm")}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t p-2 sm:p-3">
        {file && (
          <div className="mb-2 flex">
            <Badge variant="secondary" className="max-w-full gap-1.5 py-1">
              <PaperclipIcon />
              <span className="truncate">{file.name}</span>
              <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment" className="hover:text-destructive">
                <XIcon className="size-3" />
              </button>
            </Badge>
          </div>
        )}
        <div className="flex items-end gap-2">
          <FileButton onChange={setFile}>
            {(props) => (
              <Button {...props} type="button" variant={file ? "secondary" : "ghost"} size="icon" aria-label="Attach file">
                <PaperclipIcon />
              </Button>
            )}
          </FileButton>
          <Textarea
            className="max-h-32 min-h-9 flex-1 resize-none py-2"
            rows={1}
            placeholder="Write a message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button size="icon" disabled={!text.trim()} loading={send.isPending} onClick={submit} aria-label="Send">
            {!send.isPending && <SendIcon />}
          </Button>
        </div>
      </div>

      {group && (
        <Sheet open={membersOpen} onOpenChange={setMembersOpen}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-sm">
            <SheetHeader>
              <SheetTitle>{group.group_name}</SheetTitle>
              <SheetDescription>{group.members.length} members</SheetDescription>
            </SheetHeader>
            <ul className="space-y-1 px-4 pb-6">
              {group.member_names.map((name, i) => (
                <li key={group.members[i] ?? i} className="flex items-center gap-3 rounded-md p-2">
                  <ChatAvatar name={name} className="size-8" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{name || "Unknown"}</span>
                  {group.members[i] && <Badge variant="outline">{titleCase(group.members[i].split("_")[0])}</Badge>}
                </li>
              ))}
            </ul>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

// --- dialogs ------------------------------------------------------------------

function NewMessage({ contacts, onSent, onCancel }: { contacts: Contact[]; onSent: (code: string, title: string) => void; onCancel: () => void }) {
  const [to, setTo] = useState<string | null>(null);
  const [text, setText] = useState("");
  const send = useAction(
    async () => {
      const body = new FormData();
      body.append("receiver", to!);
      body.append("message", text);
      await api.post("/messages", body);
      const threads = (await api.get<Thread[]>("/messages/threads")).data;
      return threads.find((t) => t.other === to);
    },
    { invalidate: [["/messages/threads"]], onSuccess: (t) => t && onSent(t.code, t.other_name) },
  );
  return (
    <div className="grid gap-4">
      <Field label="To" required>
        <Combobox data={contactOptions(contacts)} value={to} onChange={setTo} placeholder="Choose a person" />
      </Field>
      <Field label="Message" htmlFor="new-message" required>
        <Textarea id="new-message" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={!to || !text.trim()} loading={send.isPending} onClick={() => send.mutate(undefined)}>
          <SendIcon />
          Send
        </Button>
      </DialogFooter>
    </div>
  );
}

// members are "role_id" on the server and "role-id" in the contact list
function GroupForm({ contacts, group, onDone }: { contacts: Contact[]; group?: ChatGroup; onDone: () => void }) {
  const user = useUser();
  const self = `${user.role}_${user.id}`;
  const [name, setName] = useState(group?.group_name ?? "");
  // the server always re-adds the editor, so leave them out of the picker
  const [members, setMembers] = useState<string[]>(group?.members.filter((m) => m !== self).map((m) => m.replace("_", "-")) ?? []);
  const options = contactOptions(contacts);
  const save = useAction(
    () => {
      const body = { group_name: name, members: members.map((m) => m.replace("-", "_")) };
      return group ? api.put(`/groups/${group.code}`, body) : api.post("/groups", body);
    },
    { success: group ? "Group updated" : "Group created", invalidate: [["/groups"]], onSuccess: onDone },
  );
  return (
    <div className="grid gap-4">
      <Field label="Group name" htmlFor="group-name" required>
        <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Members" description="You are always a member of groups you create or edit.">
        <MultiCombobox data={options} value={members} onChange={setMembers} placeholder="Choose members" />
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate(undefined)}>
          {group ? "Save changes" : "Create group"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// --- page -----------------------------------------------------------------------

function ListItem({ title, subtitle, time, unread, active, group, onClick }: {
  title: string; subtitle: string; time?: string; unread?: number; active: boolean; group?: boolean; onClick: () => void;
}) {  // prettier-ignore
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
      )}
    >
      <ChatAvatar name={title} group={group} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>{title}</span>
          {time && <span className={cn("shrink-0 text-[11px]", unread ? "text-primary font-medium" : "text-muted-foreground")}>{time}</span>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>{subtitle}</span>
          {!!unread && (
            <span className="bg-primary text-primary-foreground flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold">
              {unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function MessagesPage() {
  const user = useUser();
  const isAdmin = user.role === "admin";
  const threads = useGet<Thread[]>("/messages/threads");
  const groups = useGet<ChatGroup[]>("/groups");
  const contacts = useGet<Contact[]>("/messages/contacts");
  const [active, setActive] = useState<Active>(null);
  const [tab, setTab] = useState<"private" | "groups">("private");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ChatGroup | null>(null);

  const q = search.trim().toLowerCase();
  const threadItems = (threads.data ?? []).filter((t) => !q || t.other_name.toLowerCase().includes(q));
  const groupItems = (groups.data ?? []).filter((g) => !q || g.group_name.toLowerCase().includes(q) || g.member_names.some((n) => n.toLowerCase().includes(q)));
  const unreadTotal = (threads.data ?? []).reduce((acc, t) => acc + (t.unread || 0), 0);
  const activeGroup = active?.kind === "group" ? groups.data?.find((g) => g.code === active.code) : undefined;
  const loading = tab === "private" ? threads.isLoading : groups.isLoading;

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Private conversations and group chats."
        actions={
          <>
            {isAdmin && (
              <Button variant="outline" onClick={() => setGroupOpen(true)}>
                <UsersIcon />
                New group
              </Button>
            )}
            <Button onClick={() => setNewOpen(true)}>
              <MessageSquarePlusIcon />
              New message
            </Button>
          </>
        }
      />
      <Card className="h-[calc(100svh-13rem)] min-h-[30rem] flex-row gap-0 overflow-hidden py-0">
        <aside className={cn("w-full flex-col border-r md:flex md:w-80 lg:w-96", active ? "hidden" : "flex")}>
          <div className="space-y-3 border-b p-3">
            <Tabs value={tab} onValueChange={(v) => setTab(v as "private" | "groups")}>
              <TabsList className="w-full">
                <TabsTrigger value="private">
                  Private
                  {unreadTotal > 0 && <span className="bg-primary size-2 rounded-full" aria-label={`${unreadTotal} unread`} />}
                </TabsTrigger>
                <TabsTrigger value="groups">Groups</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative">
              <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input placeholder={tab === "private" ? "Search people" : "Search groups"} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
            {loading &&
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <Skeleton className="size-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            {tab === "private" &&
              threadItems.map((t) => (
                <ListItem
                  key={t.code}
                  title={t.other_name}
                  subtitle={t.last_message ?? ""}
                  time={shortTime(t.last_timestamp)}
                  unread={t.unread}
                  active={active?.code === t.code}
                  onClick={() => setActive({ kind: "thread", code: t.code, title: t.other_name })}
                />
              ))}
            {tab === "groups" &&
              groupItems.map((g) => (
                <ListItem
                  key={g.code}
                  group
                  title={g.group_name}
                  subtitle={`${g.members.length} members`}
                  time={shortTime(g.last_timestamp)}
                  active={active?.code === g.code}
                  onClick={() => setActive({ kind: "group", code: g.code, title: g.group_name })}
                />
              ))}
            {!loading && (tab === "private" ? threadItems : groupItems).length === 0 && (
              <p className="text-muted-foreground p-4 text-center text-sm">
                {q ? "Nothing matches your search" : tab === "private" ? "No conversations yet" : "You are not in any group"}
              </p>
            )}
          </div>
        </aside>
        <section className={cn("min-w-0 flex-1 flex-col md:flex", active ? "flex" : "hidden")}>
          {active ? (
            <Conversation
              key={active.code}
              active={active}
              group={activeGroup}
              isAdmin={isAdmin}
              onBack={() => setActive(null)}
              onEdit={() => activeGroup && setEditingGroup(activeGroup)}
              onDeleted={() => setActive(null)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState icon={MessagesSquareIcon} title="No conversation selected" className="border-none">
                Choose a conversation or start a new one.
              </EmptyState>
            </div>
          )}
        </section>
      </Card>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New message</DialogTitle>
          </DialogHeader>
          {newOpen && (
            <NewMessage
              contacts={contacts.data ?? []}
              onCancel={() => setNewOpen(false)}
              onSent={(code, title) => {
                setNewOpen(false);
                setTab("private");
                setActive({ kind: "thread", code, title });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>Everyone in the group can read and post messages.</DialogDescription>
          </DialogHeader>
          {groupOpen && <GroupForm contacts={contacts.data ?? []} onDone={() => setGroupOpen(false)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!editingGroup} onOpenChange={(open) => !open && setEditingGroup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit group</DialogTitle>
            <DialogDescription>Rename the group or change who is in it.</DialogDescription>
          </DialogHeader>
          {editingGroup && <GroupForm key={editingGroup.code} contacts={contacts.data ?? []} group={editingGroup} onDone={() => setEditingGroup(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
