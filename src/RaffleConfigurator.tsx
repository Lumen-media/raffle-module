import { useState, useEffect, useRef } from "react";
import { t } from "./i18n.js";
import type { LumenHost } from "@lumen-media/module-sdk";
import {
  Badge, Button, Card, Combobox, Input, Label, Popover, ScrollArea,
  Select, Separator, Switch, TextEditor,
} from "@lumen-media/module-sdk/ui";
import type { TextEditorRef } from "@lumen-media/module-sdk/ui";
import { X, Shuffle, RotateCcw, Play, Settings2 } from "lucide-react";



interface RaffledEntry {
  name: string;
  order: number;
}

interface RaffleList {
  id: string;
  name: string;
  participants: string;
}

interface SelectedBackground {
  type: "theme" | "image" | "video";
  src: string;
  name: string;
}

interface RaffleSettings {
  background: "default" | "transparent" | "card" | "media";
  backgroundMedia?: SelectedBackground;
  fontSize: number;
  fontFamily: string;
  animType: "slots" | "wheel" | "picker";
  animDuration: number;
  wheelRemoveDrawn: boolean;
}

const DEFAULT_SETTINGS: RaffleSettings = {
  background: "default",
  fontSize: 80,
  fontFamily: "",
  animType: "slots",
  animDuration: 1600,
  wheelRemoveDrawn: false,
};

interface ParticipantLine {
  name: string;
  raffled: boolean;
}

const RAFFLED_MARKER_PREFIX = /^(\s*)(?:\\?\*)+(?=\S)/;

function stripMarkdownLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

function parseParticipantLine(line: string): ParticipantLine {
  const markerMatch = line.match(RAFFLED_MARKER_PREFIX);
  const raffled = Boolean(markerMatch);
  const content = markerMatch ? line.slice(markerMatch[0].length) : line;
  return { name: stripMarkdownLine(content), raffled };
}

function parseParticipants(text: string, removeDuplicates: boolean): ParticipantLine[] {
  const participants = text
    .split("\n")
    .map(parseParticipantLine)
    .filter((participant) => participant.name.length > 0);

  if (!removeDuplicates) return participants;

  const seen = new Set<string>();
  return participants.filter((participant) => {
    if (seen.has(participant.name)) return false;
    seen.add(participant.name);
    return true;
  });
}

function addRaffledMarker(text: string, drawnName: string): string {
  let marked = false;
  return text.split("\n").map((line) => {
    if (marked) return line;
    const participant = parseParticipantLine(line);
    if (!participant.raffled && participant.name === drawnName) {
      marked = true;
      return "*" + participant.name;
    }
    return line;
  }).join("\n");
}

function removeRaffledMarkers(text: string): string {
  return text.split("\n").map((line) => {
    return line.replace(RAFFLED_MARKER_PREFIX, "$1");
  }).join("\n");
}

export function createRaffleConfigurator(host: LumenHost) {
  return function RaffleConfiguratorPanel(rawProps: unknown) {
    const { close } = (rawProps ?? {}) as { close?: () => void };

    const editorRef = useRef<TextEditorRef | null>(null);
    const [participants, setParticipants] = useState("");
    const [removeDuplicates, setRemoveDuplicates] = useState(true);
    const [doNotRepeat, setDoNotRepeat] = useState(true);
    const [alreadyRaffled, setAlreadyRaffled] = useState<RaffledEntry[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [started, setStarted] = useState(false);

    const [lists, setLists] = useState<RaffleList[]>([]);
    const [activeListId, setActiveListId] = useState<string | null>(null);
    const [settings, setSettings] = useState<RaffleSettings>(DEFAULT_SETTINGS);
    const [systemFonts, setSystemFonts] = useState<string[]>([]);
    const [newListName, setNewListName] = useState("");
    const [creatingList, setCreatingList] = useState(false);

    useEffect(() => {
      Promise.all([
        host.data.json.get<string>("participants", ""),
        host.data.json.get<boolean>("removeDuplicates", true),
        host.data.json.get<boolean>("doNotRepeat", true),
        host.data.json.get<RaffledEntry[]>("alreadyRaffled", []),
        host.data.json.get<RaffleList[]>("lists", []),
        host.data.json.get<string | null>("activeListId", null),
        host.data.json.get<RaffleSettings>("settings", DEFAULT_SETTINGS),
      ]).then(([p, rd, dnr, ad, ls, lid, st]) => {
        setParticipants(p);
        setRemoveDuplicates(rd);
        setDoNotRepeat(dnr);
        setAlreadyRaffled(ad);
        setLists(ls);
        setActiveListId(lid);
        setSettings({ ...DEFAULT_SETTINGS, ...st });
        setLoaded(true);
      });

      const h = host as unknown as { fonts?: { list(): Promise<string[]> } };
      h.fonts?.list().then((fonts) => setSystemFonts(fonts)).catch(() => { });
    }, []);

    useEffect(() => {
      const d = host.presentation.onStateChange((state) => {
        if (state === "idle") setStarted(false);
      });
      return () => d.dispose();
    }, []);

    const parsedParticipants = parseParticipants(participants, removeDuplicates);
    const eligible = parsedParticipants
      .filter((participant) => !doNotRepeat || !participant.raffled)
      .map((participant) => participant.name);

    const saveSettings = async (next: RaffleSettings) => {
      setSettings(next);
      await host.data.json.set("settings", next);
    };

    const handleParticipantsChange = async (md: string) => {
      setParticipants(md);
      await host.data.json.set("participants", md);
      if (activeListId) {
        const updated = lists.map((l) => l.id === activeListId ? { ...l, participants: md } : l);
        setLists(updated);
        await host.data.json.set("lists", updated);
      }
    };

    const handleSelectList = async (id: string) => {
      const list = lists.find((l) => l.id === id);
      if (!list) return;
      setActiveListId(id);
      await host.data.json.set("activeListId", id);
      setParticipants(list.participants);
      await host.data.json.set("participants", list.participants);
      editorRef.current?.setMarkdown(list.participants);
    };

    const handleCreateList = async () => {
      if (!newListName.trim()) return;
      const id = `list-${Date.now()}`;
      const content = activeListId ? "" : participants;
      const newList: RaffleList = { id, name: newListName.trim(), participants: content };
      const updated = [...lists, newList];
      setLists(updated);
      setActiveListId(id);
      setNewListName("");
      setCreatingList(false);
      await host.data.json.set("lists", updated);
      await host.data.json.set("activeListId", id);
      if (!activeListId) {
        setParticipants(content);
      } else {
        setParticipants("");
        await host.data.json.set("participants", "");
        editorRef.current?.setMarkdown("");
      }
    };

    const handleDeleteList = async (id: string) => {
      const updated = lists.filter((l) => l.id !== id);
      setLists(updated);
      await host.data.json.set("lists", updated);
      if (activeListId === id) {
        setActiveListId(null);
        await host.data.json.set("activeListId", null);
      }
    };

    const allNames = () => parsedParticipants.map((participant) => participant.name);
    const presentationNames = () => (doNotRepeat || settings.wheelRemoveDrawn ? eligible : allNames());

    const handleStart = () => {
      const wheelParticipants = presentationNames();
      host.presentation.project("raffle-module.raffle-screen", {
        name: null, animationKey: 0, ...settings, participants: wheelParticipants, prizeIndex: -1,
      });
      setStarted(true);
    };

    const handleRaffle = async () => {
      if (eligible.length === 0) {
        host.ui.notify({ message: t("raffle.no_eligible"), level: "warn" });
        return;
      }
      const currentEligible = [...eligible];
      const name = currentEligible[Math.floor(Math.random() * currentEligible.length)];
      const wheelParticipants = doNotRepeat || settings.wheelRemoveDrawn ? currentEligible : allNames();
      const prizeIndex = wheelParticipants.indexOf(name);

      if (doNotRepeat) {
        const updated = addRaffledMarker(participants, name);
        setParticipants(updated);
        await host.data.json.set("participants", updated);
        editorRef.current?.setMarkdown(updated);
        if (activeListId) {
          const updatedLists = lists.map((l) =>
            l.id === activeListId ? { ...l, participants: updated } : l
          );
          setLists(updatedLists);
          await host.data.json.set("lists", updatedLists);
        }
      }

      const newEntry: RaffledEntry = { name, order: alreadyRaffled.length + 1 };
      const newRaffled = [...alreadyRaffled, newEntry];
      setAlreadyRaffled(newRaffled);
      await host.data.json.set("alreadyRaffled", newRaffled);
      host.presentation.project("raffle-module.raffle-screen", {
        name, animationKey: Date.now(), ...settings, participants: wheelParticipants, prizeIndex,
      });
    };

    const handleExit = () => {
      host.presentation.clear();
      setStarted(false);
    };

    const handleReset = async () => {
      setAlreadyRaffled([]);
      await host.data.json.set("alreadyRaffled", []);
      const cleaned = removeRaffledMarkers(participants);
      setParticipants(cleaned);
      await host.data.json.set("participants", cleaned);
      editorRef.current?.setMarkdown(cleaned);
      if (activeListId) {
        const updatedLists = lists.map((l) =>
          l.id === activeListId ? { ...l, participants: cleaned } : l
        );
        setLists(updatedLists);
        await host.data.json.set("lists", updatedLists);
      }
      if (started) {
        host.presentation.clear();
        setStarted(false);
      }
    };

    const sortedRaffled = [...alreadyRaffled].sort((a, b) => b.order - a.order);
    const activeList = lists.find((l) => l.id === activeListId);
    const countNames = (text: string) => parseParticipants(text, false).filter((participant) => !participant.raffled).length;
    const fontOptions = systemFonts.length > 0 ? systemFonts : [
      "Arial", "Georgia", "Impact", "Segoe UI", "Tahoma", "Times New Roman", "Verdana",
    ];

    if (!loaded) return null;

    return (
      <div className="relative flex select-none h-[52dvh] aspect-900/534">

        {close && (
          <Button variant="ghost" size="icon-sm" onClick={close} className="absolute top-3 right-3 z-10">
            <X size={16} />
          </Button>
        )}

        <Card className="flex flex-1 flex-col gap-5 min-w-0 p-6 border-none rounded-r-none">

          <div className="flex items-center justify-between">
            <h2 className="text-lg leading-none font-bold m-0">{t("raffle.title")}</h2>

            <Popover>
              <Popover.PopoverTrigger render={
                <Button variant="ghost" size="icon-sm" />
              }>
                <Settings2 size={16} />
              </Popover.PopoverTrigger>
              <Popover.PopoverContent className="w-64">
                <div className="flex flex-col gap-4">

                  <>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t("list.section")}</span>
                      {creatingList ? (
                        <div className="flex gap-2">
                          <Input placeholder={t("list.name_placeholder")} value={newListName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewListName(e.target.value)} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleCreateList(); if (e.key === "Escape") { setCreatingList(false); setNewListName(""); } }} autoFocus className="flex-1 text-xs h-8" />
                          <Button size="sm" className="h-auto" onClick={handleCreateList}>{t("action.save")}</Button>
                        </div>
                      ) : (
                        <Select
                          value={activeListId ?? ""}
                          onValueChange={(v) => {
                            if (v === "__create__") { setCreatingList(true); return; }
                            if (v === "") { setActiveListId(null); host.data.json.set("activeListId", null); }
                            else { handleSelectList(v); }
                          }}
                        >
                          <Select.SelectTrigger className="w-full text-sm">
                            <Select.SelectValue placeholder={t("list.placeholder")}>
                              {activeList ? (
                                <span className="flex items-center justify-between w-full gap-2 truncate">
                                  <span className="truncate">{activeList.name}</span>
                                  <Badge className="text-xs shrink-0 bg-primary/60">{countNames(activeList.participants)} names</Badge>
                                </span>
                              ) : undefined}
                            </Select.SelectValue>
                          </Select.SelectTrigger>
                          <Select.SelectContent>
                            <ScrollArea>
                              {lists.length > 0 && <Select.SelectItem value="">{t("list.no_list")}</Select.SelectItem>}
                              {lists.map((l) => (
                                <Select.SelectItem key={l.id} value={l.id}>
                                  <span className="flex items-center justify-between w-full gap-3">
                                    <span className="truncate">{l.name}</span>
                                    <span className="text-xs text-muted-foreground shrink-0">{countNames(l.participants)}</span>
                                  </span>
                                </Select.SelectItem>
                              ))}
                              {lists.length > 0 && <Select.SelectSeparator />}
                              <Select.SelectItem value="__create__">{t("list.create")}</Select.SelectItem>
                            </ScrollArea>
                          </Select.SelectContent>
                        </Select>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{t("settings.appearance")}</span>
                      {([
                        [t("settings.font"), (() => {
                          const CB = Combobox as any;
                          return (
                            <CB
                              value={settings.fontFamily || null}
                              onValueChange={(val: string | null) => saveSettings({ ...settings, fontFamily: val ?? "" })}
                            >
                              <CB.ComboboxInput
                                placeholder={settings.fontFamily || "System default"}
                                className="h-8 bg-transparent"
                                style={{ width: 130, fontSize: 13 }}
                              />
                              <CB.ComboboxContent className="w-56" align="center">
                                <CB.ComboboxList>
                                  <CB.ComboboxEmpty style={{ fontSize: 12 }}>{t("settings.font_not_found")}</CB.ComboboxEmpty>
                                  {fontOptions.map((f: string) => (
                                    <CB.ComboboxItem key={f} value={f}>
                                      <span style={{ fontFamily: f, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", maxWidth: 200 }}>{f}</span>
                                    </CB.ComboboxItem>
                                  ))}
                                </CB.ComboboxList>
                              </CB.ComboboxContent>
                            </CB>
                          );
                        })()],
                        [t("settings.font_size"), (
                          <Select value={String(settings.fontSize)} onValueChange={(v) => saveSettings({ ...settings, fontSize: Number(v) })}>
                            <Select.SelectTrigger className="text-sm" style={{ width: 130 }}><Select.SelectValue /></Select.SelectTrigger>
                            <Select.SelectContent>
                              {[24, 32, 40, 48, 56, 64, 72, 80, 96, 112, 120].map((s) => <Select.SelectItem key={s} value={String(s)}>{s}px</Select.SelectItem>)}
                            </Select.SelectContent>
                          </Select>
                        )],
                        [t("settings.animation"), (
                          <Select value={settings.animType} onValueChange={(v) => saveSettings({ ...settings, animType: v as RaffleSettings["animType"] })}>
                            <Select.SelectTrigger className="text-sm" style={{ width: 130 }}><Select.SelectValue /></Select.SelectTrigger>
                            <Select.SelectContent>
                              <Select.SelectItem value="slots">{t("settings.anim.slots")}</Select.SelectItem>
                              <Select.SelectItem value="wheel">{t("settings.anim.wheel")}</Select.SelectItem>
                              <Select.SelectItem value="picker">{t("settings.anim.picker")}</Select.SelectItem>
                            </Select.SelectContent>
                          </Select>
                        )],
                      ] as [string, React.ReactNode][]).map(([label, control]) => (
                        <div key={label} className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">{label}</span>
                          {control}
                        </div>
                      ))}
                      {settings.animType === "wheel" && (
                        <Label className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">{t("settings.wheel_remove_drawn")}</span>
                          <Switch checked={settings.wheelRemoveDrawn} onCheckedChange={(v: boolean) => saveSettings({ ...settings, wheelRemoveDrawn: v })} />
                        </Label>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{t("settings.background")}</span>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t("settings.bg.type")}</span>
                        <Select value={settings.background} onValueChange={(v) => saveSettings({ ...settings, background: v as RaffleSettings["background"] })}>
                          <Select.SelectTrigger className="text-sm" style={{ width: 130 }}><Select.SelectValue /></Select.SelectTrigger>
                          <Select.SelectContent>
                            <Select.SelectItem value="default">{t("settings.bg.default")}</Select.SelectItem>
                            <Select.SelectItem value="transparent">{t("settings.bg.transparent")}</Select.SelectItem>
                            <Select.SelectItem value="card">{t("settings.bg.card")}</Select.SelectItem>
                            <Select.SelectItem value="media">{t("settings.bg.media")}</Select.SelectItem>
                          </Select.SelectContent>
                        </Select>
                      </div>
                      {settings.background === "media" && (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground flex-1 truncate">
                            {settings.backgroundMedia?.name ?? t("list.none_selected")}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => (host.ui as any).openBackgroundPicker((bg: SelectedBackground) => {
                              saveSettings({ ...settings, background: "media", backgroundMedia: bg });
                            })}
                            className="text-xs shrink-0"
                          >
                            Choose
                          </Button>
                        </div>
                      )}
                    </div>
                  </>

                </div>
              </Popover.PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-col gap-3 bg-secondary rounded-lg py-3.5 px-4.5">
            <Label className="flex items-center justify-between" htmlFor="remove-duplicates">{t("participants.remove_duplicates")}
              <Switch id="remove-duplicates" checked={removeDuplicates}
                onCheckedChange={async (v: boolean) => {
                  setRemoveDuplicates(v);
                  await host.data.json.set("removeDuplicates", v);
                }} />
            </Label>
            <Label className="flex items-center justify-between" htmlFor="do-not-repeat">{t("participants.no_repeat")}
              <Switch id="do-not-repeat" checked={doNotRepeat}
                onCheckedChange={async (v: boolean) => {
                  setDoNotRepeat(v);
                  await host.data.json.set("doNotRepeat", v);
                }} />
            </Label>
          </div>

          <div className="flex flex-col gap-2 flex-1 min-h-0">

            <div className="flex justify-between items-center">
              <Label className="text-muted-foreground">{t("participants.label")}</Label>
              {activeListId && (
                <Label className="text-xs text-muted-foreground">
                  List: <span className="text-foreground font-medium">{activeList?.name}</span>
                </Label>
              )}
            </div>
            <ScrollArea className="flex-1 min-h-0 overflow-hidden bg-secondary rounded-xl select-text">
              <TextEditor
                ref={editorRef}
                defaultValue={participants}
                placeholder={t("participants.placeholder")}
                debounce={300}
                onChange={handleParticipantsChange}
              />
            </ScrollArea>
            <p className="text-xs text-muted-foreground m-0">
              {t("participants.hint")}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {eligible.length !== 1 ? t("raffle.ready_plural", { count: eligible.length }) : t("raffle.ready", { count: eligible.length })}
            </span>
            <div className="flex gap-2">
              {started ? (
                <Button variant="outline" onClick={handleExit} className="flex items-center gap-2">
                  <X size={16} /> Exit
                </Button>
              ) : (
                <Button variant="outline" onClick={handleReset} className="flex items-center gap-2">
                  <RotateCcw size={16} /> Reset
                </Button>
              )}
              {started ? (
                <Button onClick={handleRaffle} className="flex items-center gap-2">
                  <Shuffle size={16} /> Raffle
                </Button>
              ) : (
                <Button onClick={handleStart} className="flex items-center gap-2">
                  <Play size={16} /> Start
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Separator orientation="vertical" />

        <Card className="flex flex-col gap-3 p-6 border-none rounded-l-none bg-secondary overflow-hidden" style={{ width: 280 }}>
          <h3 className="text-base leading-none font-bold m-0">{t("raffle.already_raffled")}</h3>
          <ScrollArea className="flex-1 min-h-0">
            <div className="flex flex-col gap-2">
              {sortedRaffled.map((entry) => (
                <div key={entry.order} className="flex items-center justify-between bg-card rounded-lg py-2.5 px-3.5">
                  <span className="text-sm">{entry.name}</span>
                  <Badge variant="secondary">#{entry.order}</Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>

      </div>
    );
  };
}
