import {
    CreateStartUpPageContainer,
    OsEventTypeList,
    RebuildPageContainer,
    TextContainerProperty,
    TextContainerUpgrade,
    waitForEvenAppBridge,
    type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import { detectUiLanguage, isUiLanguage, parseUiLanguage, setUiLanguage, t, type UiLanguage } from "./i18n";
import "./style.css";

interface Feed {
    id: string;
    title: string;
    url: string;
}

interface Article {
    id: string;
    feedId: string;
    feedTitle: string;
    title: string;
    url: string;
    publishedAt: string;
    author: string;
    body: string;
}

interface SavedState {
    feeds: Feed[];
    articles: Article[];
    lastUpdatedAt: string;
}

const STORAGE_KEY = "even-rss-state-v1";
const PROXY_STORAGE_KEY = "even-rss-proxy-url-v1";
const UI_LANGUAGE_STORAGE_KEY = "even-rss-ui-language-v1";
const MAX_FEEDS = 12;
const MAX_ARTICLES = 60;
const MAX_BODY_LENGTH = 5000;
const LIST_CONTAINER_ID = 1;
const EMPTY_LIST_CONTAINER_ID = 1;
const LIST_CONTAINER_NAME = "news-item";
const ARTICLE_CONTAINER_ID = 1;
const ARTICLE_CONTAINER_NAME = "main";
const GLASS_LIST_PAGE_SIZE = 5;
const LIST_INPUT_CONTAINER_ID = LIST_CONTAINER_ID + GLASS_LIST_PAGE_SIZE;
const GLASS_LIST_TITLE_MAX_WIDTH = 56;
const GLASS_LIST_ROW_HEIGHT = 74;
const GLASS_LIST_VISIBLE_COUNT = 3;
const GLASS_BODY_LINE_WIDTH = 36;
const GLASS_BODY_PAGE_LINES = 9;
const RSS_PROXY_URL = import.meta.env.VITE_RSS_PROXY_URL?.trim() ?? "";
let rssProxyUrl = loadProxyUrl() || RSS_PROXY_URL;
setUiLanguage(getInitialUiLanguage());
const EMPTY_STATE: SavedState = { feeds: [], articles: [], lastUpdatedAt: "" };
const LOCAL_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const LOCAL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

document.documentElement.lang = detectUiLanguage();
document.title = t("documentTitle");
document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", t("metaDescription"));

let state = loadLocalState();
let bridge: EvenAppBridge | null = null;
let glassPageCreated = false;
let glassRenderedMode: "list" | "article" | null = null;
let glassRenderedListType: "cards" | "empty" | null = null;
let glassMode: "list" | "article" = "list";
let glassArticleId = "";
let glassBodyPage = 0;
let glassSelectedIndex = 0;
let glassRefreshStatus = "";
let isRefreshing = false;
let selectedFeedId = "all";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root element is missing.");

const languageOptions: { value: UiLanguage; label: string }[] = [
    { value: "en", label: "English" },
    { value: "zh-Hans", label: "简体中文" },
    { value: "zh-Hant", label: "繁體中文" },
    { value: "ja", label: "日本語" },
    { value: "es", label: "Español" },
    { value: "fr", label: "Français" },
    { value: "de", label: "Deutsch" },
    { value: "it", label: "Italiano" },
    { value: "ko", label: "한국어" },
];

app.innerHTML = `
    <div class="page-shell">
        <header class="topbar">
            <a class="brand" href="#" aria-label="${t("brandHome")}">
                <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
                <span class="brand-copy"><strong>even</strong><span>${t("brandTagline")}</span></span>
            </a>
            <div class="topbar-meta"><span class="connection-dot"></span><span id="connection-label">${t("connectionConnecting")}</span></div>
            <button id="refresh-button" class="button button-quiet" type="button" aria-label="${t("refreshAria")}">
                <span class="refresh-icon" aria-hidden="true">↻</span><span>${t("refreshButton")}</span>
            </button>
        </header>

        <main class="dashboard">
            <section class="reader-column" aria-labelledby="page-title">
                <div class="page-intro">
                    <div class="eyebrow"><span class="eyebrow-line"></span>${t("eyebrowDaily")}</div>
                    <h1 id="page-title">${t("heroTitle")}</h1>
                    <p>${t("heroDescription")}</p>
                </div>

                <section class="feed-setup" aria-labelledby="feed-setup-title">
                    <div class="section-heading">
                        <div><span class="section-index">01</span><h2 id="feed-setup-title">${t("feedAddHeading")}</h2></div>
                        <span class="feed-count" id="feed-count">0 / ${MAX_FEEDS}</span>
                    </div>
                    <form id="feed-form" class="feed-form">
                        <label class="field-label" for="feed-url">${t("feedUrlLabel")}</label>
                        <div class="input-row">
                            <span class="input-prefix" aria-hidden="true">↗</span>
                            <input id="feed-url" name="url" type="url" placeholder="https://example.com/feed.xml" autocomplete="url" required>
                            <button class="button button-primary" type="submit"><span>${t("addButton")}</span><span aria-hidden="true">＋</span></button>
                        </div>
                        <p class="form-hint">${t("feedHint")}</p>
                    </form>
                    <div id="feed-message" class="inline-message" role="status" aria-live="polite"></div>
                    <div id="feed-list" class="feed-list"></div>
                    <details class="proxy-settings">
                        <summary>${t("workerSettings")}</summary>
                        <form id="proxy-form" class="proxy-form">
                            <label class="field-label" for="proxy-url">${t("workerUrlLabel")}</label>
                            <div class="input-row">
                                <span class="input-prefix" aria-hidden="true">↗</span>
                                <input id="proxy-url" name="url" type="url" value="${escapeHtml(rssProxyUrl)}" placeholder="https://your-worker.workers.dev/" autocomplete="url">
                                <button class="button button-primary" type="submit"><span>${t("saveWorker")}</span></button>
                            </div>
                            <button id="proxy-reset-button" class="button button-quiet proxy-reset" type="button">${t("resetWorker")}</button>
                            <p class="form-hint">${t("workerHint")}</p>
                        </form>
                        <div id="proxy-message" class="inline-message" role="status" aria-live="polite"></div>
                    </details>
                    <details class="proxy-settings language-settings">
                        <summary>${t("displayLanguage")}</summary>
                        <div class="language-setting">
                            <select id="language-select" aria-label="${escapeHtml(t("displayLanguage"))}">
                                ${languageOptions.map(({ value, label }) => `<option value="${value}">${label}</option>`).join("")}
                            </select>
                        </div>
                    </details>
                </section>

                <section class="articles-section" aria-labelledby="articles-title">
                    <div class="section-heading articles-heading">
                        <div><span class="section-index">02</span><h2 id="articles-title">${t("latestArticles")}</h2><span class="article-total" id="article-count">0</span></div>
                        <label class="select-wrap"><span class="sr-only">${t("feedFilterLabel")}</span><select id="feed-filter"><option value="all">${t("allFeeds")}</option></select><span aria-hidden="true">⌄</span></label>
                    </div>
                    <div id="article-list" class="article-list"></div>
                    <div id="empty-state" class="empty-state" hidden>
                        <span class="empty-icon" aria-hidden="true">⌁</span>
                        <h3>${t("noArticles")}</h3>
                        <p>${t("noArticlesHint")}</p>
                    </div>
                </section>

                <footer class="phone-footer">
                    <span class="footer-lock" aria-hidden="true">◈</span>${t("savedLocally")}
                </footer>
            </section>

            <aside class="glass-column" aria-label="${t("glassPreviewAria")}">
                <div class="glass-heading">
                    <span class="glass-live"><i></i><span id="glass-status">${t("glassStatusPreview")}</span></span>
                </div>
                <div class="display-preview-stage">
                    <div class="display-screen">
                        <div id="glass-preview" class="screen-content"></div>
                    </div>
                </div>
                <div class="glass-controls"><span class="control-pill"><kbd>↑↓</kbd> ${t("chooseArticle")}</span><span class="control-pill"><kbd>${t("tap")}</kbd> ${t("openBody")}</span></div>
                <div class="glass-info">
                    <div class="info-icon" aria-hidden="true">◉</div>
                    <p>${t("glassInfo")}</p>
                    <span class="sync-mark"><i></i>${t("sync")}</span>
                </div>
                <a class="preview-privacy-link" href="./privacy.html">${t("privacyPolicy")}</a>
                <div class="preview-caption"><span class="caption-dot"></span>${t("previewCaption")}</div>
            </aside>
        </main>
        <div id="toast" class="toast" role="status" aria-live="polite"></div>
        <dialog id="article-dialog" class="article-dialog">
            <form method="dialog"><button class="dialog-close" aria-label="${t("close")}">×</button></form>
            <div id="dialog-content"></div>
        </dialog>
    </div>
`;

const feedForm = document.querySelector<HTMLFormElement>("#feed-form")!;
const proxyForm = document.querySelector<HTMLFormElement>("#proxy-form")!;
const languageSelect = document.querySelector<HTMLSelectElement>("#language-select")!;
const feedUrlInput = document.querySelector<HTMLInputElement>("#feed-url")!;
const proxyUrlInput = document.querySelector<HTMLInputElement>("#proxy-url")!;
const proxyResetButton = document.querySelector<HTMLButtonElement>("#proxy-reset-button")!;
const feedMessage = document.querySelector<HTMLDivElement>("#feed-message")!;
const proxyMessage = document.querySelector<HTMLDivElement>("#proxy-message")!;
const feedList = document.querySelector<HTMLDivElement>("#feed-list")!;
const feedFilter = document.querySelector<HTMLSelectElement>("#feed-filter")!;
const articleList = document.querySelector<HTMLDivElement>("#article-list")!;
const articleCount = document.querySelector<HTMLSpanElement>("#article-count")!;
const emptyState = document.querySelector<HTMLDivElement>("#empty-state")!;
const glassPreview = document.querySelector<HTMLDivElement>("#glass-preview")!;
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-button")!;
const feedCount = document.querySelector<HTMLSpanElement>("#feed-count")!;
const toast = document.querySelector<HTMLDivElement>("#toast")!;
const articleDialog = document.querySelector<HTMLDialogElement>("#article-dialog")!;
const dialogContent = document.querySelector<HTMLDivElement>("#dialog-content")!;

languageSelect.value = detectUiLanguage();
languageSelect.addEventListener("change", () => {
    const language = parseUiLanguage(languageSelect.value);
    if (language) void changeUiLanguage(language);
});

feedForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addFeed(feedUrlInput.value);
});

proxyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = proxyUrlInput.value.trim();
    if (value) {
        try {
            const parsedUrl = new URL(value);
            if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) throw new Error();
        } catch {
            proxyMessage.textContent = t("invalidWorkerUrl");
            proxyMessage.className = "inline-message error";
            return;
        }
    }

    try {
        if (value) localStorage.setItem(PROXY_STORAGE_KEY, value);
        else localStorage.removeItem(PROXY_STORAGE_KEY);
        rssProxyUrl = value || RSS_PROXY_URL;
        proxyUrlInput.value = rssProxyUrl;
        proxyMessage.textContent = t("workerSettingsSaved");
        proxyMessage.className = "inline-message success";
    } catch (error) {
        console.error("Could not save RSS proxy settings.", error);
        proxyMessage.textContent = t("workerSettingsSaveFailed");
        proxyMessage.className = "inline-message error";
    }
});

proxyResetButton.addEventListener("click", () => {
    try {
        localStorage.removeItem(PROXY_STORAGE_KEY);
        rssProxyUrl = RSS_PROXY_URL;
        proxyUrlInput.value = RSS_PROXY_URL;
        proxyMessage.textContent = t("workerSettingsReset");
        proxyMessage.className = "inline-message success";
    } catch (error) {
        console.error("Could not reset RSS proxy settings.", error);
        proxyMessage.textContent = t("workerSettingsSaveFailed");
        proxyMessage.className = "inline-message error";
    }
});

feedFilter.addEventListener("change", () => {
    selectedFeedId = feedFilter.value;
    render();
});

feedList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const removeButton = target.closest<HTMLButtonElement>("[data-remove-feed]");
    if (!removeButton) return;
    void removeFeed(removeButton.dataset.removeFeed ?? "");
});

articleList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const articleButton = target.closest<HTMLButtonElement>("[data-article-id]");
    if (!articleButton) return;
    openArticle(articleButton.dataset.articleId ?? "");
});

refreshButton.addEventListener("click", () => void refreshFeeds());

render();
void connectEvenBridge();

async function connectEvenBridge(): Promise<void> {
    try {
        bridge = await waitForEvenAppBridge();
        if (await restoreUiLanguageFromBridge()) return;
        await renderGlasses(true);
        const storedState = parseSavedState(await bridge.getLocalStorage(STORAGE_KEY));
        if (storedState.feeds.length || storedState.articles.length) {
            state = mergeStates(state, storedState);
            saveLocalState();
        } else {
            await saveState();
        }
        document.querySelector("#connection-label")!.textContent = t("connectionConnected");
        document.querySelector(".connection-dot")!.classList.add("connected");
        document.querySelector("#glass-status")!.textContent = t("glassStatusConnected");
        document.querySelector(".glass-live")!.classList.add("connected");
        render();
        bridge.onEvenHubEvent((event) => {
            if (glassMode === "list" && event.sysEvent?.eventType === OsEventTypeList.LONG_PRESS_EVENT) {
                void refreshFeeds(true);
                return;
            }
            const systemEvent = event.sysEvent;
            if (systemEvent?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT && glassMode === "article") {
                glassMode = "list";
                glassArticleId = "";
                glassBodyPage = 0;
                renderGlassPreview();
                void renderGlasses();
                return;
            }
            if (systemEvent?.eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT || systemEvent?.eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
                if (glassMode === "list") void handleGlassListInput(systemEvent.eventType);
                else void moveGlassBody(systemEvent.eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT ? 1 : -1);
                return;
            }
            if (systemEvent && (systemEvent.eventType === OsEventTypeList.CLICK_EVENT || (systemEvent.eventType === undefined && systemEvent.eventSource !== undefined))) {
                if (glassMode === "list") void handleGlassListInput(undefined);
                else void moveGlassBody(1);
                return;
            }
            const textEvent = event.textEvent;
            if (glassMode === "list" && textEvent && (
                textEvent.containerID === EMPTY_LIST_CONTAINER_ID
                || textEvent.containerID === LIST_INPUT_CONTAINER_ID
                || (typeof textEvent.containerID === "number" && textEvent.containerID >= LIST_CONTAINER_ID && textEvent.containerID < LIST_CONTAINER_ID + GLASS_LIST_PAGE_SIZE)
            )) {
                void handleGlassListInput(textEvent.eventType);
                return;
            }
            if (glassMode !== "article" || textEvent?.containerID !== ARTICLE_CONTAINER_ID) return;
            switch (textEvent.eventType) {
                case OsEventTypeList.CLICK_EVENT:
                case undefined:
                case OsEventTypeList.SCROLL_BOTTOM_EVENT:
                    void moveGlassBody(1);
                    break;
                case OsEventTypeList.SCROLL_TOP_EVENT:
                    void moveGlassBody(-1);
                    break;
                case OsEventTypeList.DOUBLE_CLICK_EVENT:
                    glassMode = "list";
                    glassArticleId = "";
                    glassBodyPage = 0;
                    renderGlassPreview();
                    void renderGlasses();
                    break;
            }
        });
    } catch (error) {
        console.info("Even Hub bridge is not available in this browser.", error);
    }
}

async function changeUiLanguage(language: UiLanguage): Promise<void> {
    setUiLanguage(language);
    let savedLocally = false;
    try {
        localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, language);
        savedLocally = true;
    } catch (error) {
        console.error("Could not save display language locally.", error);
    }

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete("lang");
    if (!savedLocally) currentUrl.searchParams.set("lang", language);
    window.history.replaceState(null, "", currentUrl);

    if (bridge) {
        try {
            await bridge.setLocalStorage(UI_LANGUAGE_STORAGE_KEY, language);
        } catch (error) {
            console.error("Could not sync display language with Even Hub.", error);
        }
    }

    window.location.reload();
}

async function restoreUiLanguageFromBridge(): Promise<boolean> {
    if (getUrlLanguageOverride()) return false;

    const localLanguage = readStoredUiLanguage();
    let storedLanguage: UiLanguage | null = null;
    try {
        storedLanguage = parseUiLanguage(await bridge!.getLocalStorage(UI_LANGUAGE_STORAGE_KEY));
    } catch (error) {
        console.error("Could not read display language from Even Hub.", error);
    }

    if (!localLanguage && storedLanguage) {
        setUiLanguage(storedLanguage);
        try {
            localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, storedLanguage);
        } catch (error) {
            console.error("Could not cache display language locally.", error);
        }
        if (readStoredUiLanguage() !== storedLanguage) {
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set("lang", storedLanguage);
            window.history.replaceState(null, "", currentUrl);
        }
        window.location.reload();
        return true;
    }

    const language = localLanguage ?? detectUiLanguage();
    if (storedLanguage !== language) {
        try {
            await bridge!.setLocalStorage(UI_LANGUAGE_STORAGE_KEY, language);
        } catch (error) {
            console.error("Could not initialize display language in Even Hub.", error);
        }
    }
    return false;
}

async function addFeed(rawUrl: string): Promise<void> {
    const normalizedUrl = rawUrl.trim();
    if (state.feeds.length >= MAX_FEEDS) {
        setFeedMessage(t("feedLimit", { max: MAX_FEEDS }), "error");
        return;
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(normalizedUrl);
        if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error();
    } catch {
        setFeedMessage(t("invalidUrl"), "error");
        return;
    }

    if (state.feeds.some((feed) => feed.url === parsedUrl.href)) {
        setFeedMessage(t("duplicateFeed"), "error");
        return;
    }

    setFeedMessage(t("checkingFeed"), "loading");
    feedUrlInput.disabled = true;
    feedForm.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = true;
    try {
        const fetched = await fetchFeed(parsedUrl.href);
        const feed: Feed = {
            id: generateId(),
            title: fetched.title || parsedUrl.hostname,
            url: parsedUrl.href,
        };
        const articles = fetched.articles.map((article) => ({ ...article, feedId: feed.id, feedTitle: feed.title }));
        state.feeds.unshift(feed);
        state.articles = mergeArticles(state.articles, articles);
        state.lastUpdatedAt = new Date().toISOString();
        selectedFeedId = "all";
        feedUrlInput.value = "";
        await saveState();
        render();
        setFeedMessage(t("feedAdded", { title: feed.title, count: articles.length }), "success");
    } catch (error) {
        setFeedMessage(getFetchErrorMessage(error), "error");
    } finally {
        feedUrlInput.disabled = false;
        feedForm.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = false;
    }
}

async function removeFeed(feedId: string): Promise<void> {
    const feed = state.feeds.find((item) => item.id === feedId);
    if (!feed) return;
    state.feeds = state.feeds.filter((item) => item.id !== feedId);
    state.articles = state.articles.filter((item) => item.feedId !== feedId);
    if (selectedFeedId === feedId) selectedFeedId = "all";
    await saveState();
    render();
    showToast(t("feedDeleted", { title: feed.title }));
}

async function refreshFeeds(fromGlasses = false): Promise<void> {
    if (isRefreshing) return;
    if (!state.feeds.length) {
        if (fromGlasses) {
            glassRefreshStatus = t("registerPhone");
            await renderGlasses();
        } else {
            showToast(t("addFeedFirst"));
        }
        return;
    }
    isRefreshing = true;
    refreshButton.disabled = true;
    refreshButton.classList.add("is-loading");
    if (fromGlasses) {
        glassRefreshStatus = t("refreshing");
        void renderGlasses();
    }
    const results = await Promise.all(state.feeds.map(async (feed) => {
        try {
            return { feed, result: await fetchFeed(feed.url), error: "" };
        } catch (error) {
            return { feed, result: null, error: getFetchErrorMessage(error) };
        }
    }));

    let updated = 0;
    const nextArticles: Article[] = [...state.articles];
    for (const { feed, result } of results) {
        if (!result) continue;
        const freshArticles = result.articles.map((article) => ({ ...article, feedId: feed.id, feedTitle: result.title || feed.title }));
        nextArticles.push(...freshArticles);
        feed.title = result.title || feed.title;
        updated += freshArticles.length;
    }
    state.articles = mergeArticles([], nextArticles);
    state.lastUpdatedAt = new Date().toISOString();
    const failed = results.filter((result) => result.error).length;
    if (fromGlasses) {
        glassSelectedIndex = 0;
        glassRefreshStatus = failed ? t("refreshFailed", { count: failed }) : t("refreshComplete");
    }
    await saveState();
    render();
    isRefreshing = false;
    refreshButton.disabled = false;
    refreshButton.classList.remove("is-loading");
    showToast(failed
        ? t("refreshResultFailed", { updated, failed })
        : t("refreshResult", { updated }));
}

interface FetchedFeed {
    title: string;
    articles: Omit<Article, "feedId" | "feedTitle">[];
}

async function fetchFeed(url: string): Promise<FetchedFeed> {
    if (!rssProxyUrl) throw new Error("proxy-not-configured");
    let response: Response;
    try {
        const proxyUrl = new URL(rssProxyUrl);
        proxyUrl.searchParams.set("url", url);
        response = await requestFeed(proxyUrl.href);
    } catch {
        throw new Error("proxy-error");
    }

    const xmlText = await response.text();
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("invalid-xml");

    const rssItems = Array.from(xml.getElementsByTagName("item"));
    const atomItems = Array.from(xml.getElementsByTagNameNS("*", "entry"));
    const itemNodes = rssItems.length ? rssItems : atomItems;
    if (!itemNodes.length) throw new Error("empty-feed");

    const channel = xml.getElementsByTagName("channel")[0] ?? xml.documentElement;
    const channelTitle = childText(channel, ["title"]) || new URL(url).hostname;
    const articles = itemNodes.map((item): Omit<Article, "feedId" | "feedTitle"> => {
        const title = childText(item, ["title"]) || t("untitled");
        const linkElement = item.getElementsByTagName("link")[0];
        const link = linkElement?.getAttribute("href") || linkElement?.textContent?.trim() || "";
        const publishedAt = childText(item, ["pubDate", "published", "updated", "date"]);
        const author = childText(item, ["author", "creator", "name"]);
        const content = descendantText(item, ["encoded", "content", "description", "summary"]);
        const body = htmlToText(content);
        const stableKey = childText(item, ["guid", "id"]) || link || `${title}-${publishedAt}`;
        return {
            id: `${url}::${stableKey}`,
            title,
            url: resolveUrl(link, url),
            publishedAt: normalizeDate(publishedAt),
            author,
            body: body.slice(0, MAX_BODY_LENGTH),
        };
    });
    return { title: channelTitle, articles: articles.sort(compareArticles).slice(0, 30) };
}

async function requestFeed(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
        let response: Response;
        try {
            response = await fetch(url, {
                headers: { Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml, */*" },
                signal: controller.signal,
            });
        } catch (error) {
            if (error instanceof TypeError) throw new Error("network-error");
            throw error;
        }
        if (!response.ok) throw new Error(`http:${response.status}`);
        return response;
    } finally {
        window.clearTimeout(timeout);
    }
}

function render(): void {
    feedCount.textContent = `${state.feeds.length} / ${MAX_FEEDS}`;
    renderFeeds();
    renderFilter();
    renderArticles();
    renderGlassPreview();
    void renderGlasses();
}

function renderFeeds(): void {
    if (!state.feeds.length) {
        feedList.innerHTML = `<div class="feed-empty"><span aria-hidden="true">＋</span><p>${t("feedEmpty")}</p></div>`;
        return;
    }
    feedList.innerHTML = state.feeds.map((feed) => `
        <div class="feed-row">
            <span class="feed-favicon" aria-hidden="true">${escapeHtml(feed.title.slice(0, 1).toUpperCase())}</span>
            <span class="feed-detail"><strong>${escapeHtml(feed.title)}</strong><small>${escapeHtml(hostName(feed.url))}</small></span>
            <span class="feed-item-count">${state.articles.filter((article) => article.feedId === feed.id).length}</span>
            <button class="remove-feed" type="button" data-remove-feed="${escapeHtml(feed.id)}" aria-label="${escapeHtml(t("removeFeed", { title: feed.title }))}">×</button>
        </div>
    `).join("");
}

function renderFilter(): void {
    const selected = selectedFeedId;
    feedFilter.innerHTML = `<option value="all">${t("allFeeds")}</option>${state.feeds.map((feed) => `<option value="${escapeHtml(feed.id)}">${escapeHtml(feed.title)}</option>`).join("")}`;
    feedFilter.value = state.feeds.some((feed) => feed.id === selected) || selected === "all" ? selected : "all";
}

function renderArticles(): void {
    const articles = getVisibleArticles();
    articleCount.textContent = String(articles.length).padStart(2, "0");
    emptyState.hidden = articles.length > 0;
    articleList.innerHTML = articles.map((article, index) => `
        <button class="article-card" type="button" data-article-id="${escapeHtml(article.id)}">
            <span class="article-order">${String(index + 1).padStart(2, "0")}</span>
            <span class="article-main">
                <span class="article-meta"><span>${escapeHtml(article.feedTitle)}</span><i></i><time>${escapeHtml(formatDate(article.publishedAt))}</time></span>
                <strong>${escapeHtml(getArticleTitle(article))}</strong>
                <span class="article-excerpt">${escapeHtml(excerpt(getArticleBody(article), 108))}</span>
            </span>
            <span class="article-arrow" aria-hidden="true">↗</span>
        </button>
    `).join("");
}

function renderGlassPreview(): void {
    const sampleTitles = [
        t("previewSampleTitleOne"),
        t("previewSampleTitleTwo"),
        t("previewSampleTitleThree"),
    ];
    const now = Date.now();
    glassPreview.innerHTML = sampleTitles.map((title, index) => `
        <div class="screen-item ${index === 0 ? "active" : ""}">
            <div class="screen-item-meta"><span>▤ ${escapeHtml(t("previewSampleFeed"))}</span><time>${escapeHtml(formatDate(new Date(now - index * 60 * 60 * 1000).toISOString()))}</time></div>
            <div class="screen-item-title">${escapeHtml(title)}</div>
        </div>
    `).join("");
}

function getVisibleArticles(): Article[] {
    const articles = [...state.articles].sort(compareArticles);
    return selectedFeedId === "all" ? articles : articles.filter((article) => article.feedId === selectedFeedId);
}

function openArticle(articleId: string): void {
    const article = state.articles.find((item) => item.id === articleId);
    if (!article) return;
    dialogContent.innerHTML = `
        <div class="dialog-meta">${escapeHtml(article.feedTitle)} <i></i> ${escapeHtml(formatDate(article.publishedAt))}</div>
        <h2>${escapeHtml(getArticleTitle(article))}</h2>
        <p class="dialog-author">${escapeHtml(article.author)}</p>
        <div class="dialog-body">${escapeHtml(getArticleBody(article))}</div>
        <a class="source-link" href="${escapeAttribute(article.url)}" target="_blank" rel="noreferrer">${t("openSource")} <span aria-hidden="true">↗</span></a>
    `;
    articleDialog.showModal();
    glassArticleId = articleId;
    glassMode = "article";
    glassBodyPage = 0;
    void renderGlasses();
}

async function renderGlasses(isInitial = false): Promise<void> {
    if (!bridge) return;
    if (glassMode === "article") {
        const article = state.articles.find((item) => item.id === glassArticleId);
        if (!article) {
            glassMode = "list";
            glassArticleId = "";
        } else {
            const content = glassArticleContent(article, glassBodyPage);
            if (isInitial || !glassPageCreated) {
                const text = new TextContainerProperty({
                    xPosition: 8,
                    yPosition: 6,
                    width: 560,
                    height: 276,
                    zOrderIndex: 1,
                    borderWidth: 1,
                    borderColor: 15,
                    borderRadius: 8,
                    paddingLength: 6,
                    containerID: ARTICLE_CONTAINER_ID,
                    containerName: ARTICLE_CONTAINER_NAME,
                    content,
                    isEventCapture: 1,
                });
                const page = new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [text] });
                const result = await bridge.createStartUpPageContainer(page);
                glassPageCreated = result === 0;
                glassRenderedMode = glassPageCreated ? "article" : null;
                glassRenderedListType = null;
                if (!glassPageCreated) console.error("Could not create the G2 article page.", result);
                return;
            }
            const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer({
                containerTotalNum: 1,
                textObject: [new TextContainerProperty({
                    xPosition: 8,
                    yPosition: 6,
                    width: 560,
                    height: 276,
                    zOrderIndex: 1,
                    borderWidth: 1,
                    borderColor: 15,
                    borderRadius: 8,
                    paddingLength: 6,
                    containerID: ARTICLE_CONTAINER_ID,
                    containerName: ARTICLE_CONTAINER_NAME,
                    content,
                    isEventCapture: 1,
                })],
            }));
            if (!rebuilt) console.error("Could not rebuild the G2 article page.");
            else {
                glassRenderedMode = "article";
                glassRenderedListType = null;
            }
            return;
        }
    }

    const articles = getVisibleArticles();
    if (!articles.length) {
        const emptyText = new TextContainerProperty({
            xPosition: 8,
            yPosition: 6,
            width: 560,
            height: 276,
            zOrderIndex: 1,
            borderWidth: 0,
            paddingLength: 6,
            containerID: EMPTY_LIST_CONTAINER_ID,
            containerName: LIST_CONTAINER_NAME,
            content: glassEmptyListContent(),
            isEventCapture: 1,
        });
        if (isInitial || !glassPageCreated) {
            const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
                containerTotalNum: 1,
                textObject: [emptyText],
            }));
            glassPageCreated = result === 0;
            glassRenderedMode = glassPageCreated ? "list" : null;
            glassRenderedListType = glassPageCreated ? "empty" : null;
            if (!glassPageCreated) console.error("Could not create the G2 article list.", result);
            return;
        }
        if (glassRenderedMode === "list" && glassRenderedListType === "empty") {
            const upgraded = await bridge.textContainerUpgrade(new TextContainerUpgrade({
                containerID: EMPTY_LIST_CONTAINER_ID,
                containerName: LIST_CONTAINER_NAME,
                content: emptyText.content,
                contentOffset: 0,
                contentLength: 0,
            }));
            if (!upgraded) console.error("Could not update the G2 empty article list.");
            return;
        }
        const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer({
            containerTotalNum: 1,
            textObject: [emptyText],
        }));
        if (!rebuilt) console.error("Could not rebuild the G2 empty article list.");
        else {
            glassRenderedMode = "list";
            glassRenderedListType = "empty";
        }
        return;
    }

    glassSelectedIndex = Math.min(glassSelectedIndex, articles.length - 1);
    const pageStart = Math.floor(glassSelectedIndex / GLASS_LIST_PAGE_SIZE) * GLASS_LIST_PAGE_SIZE;
    const pageArticles = articles.slice(pageStart, pageStart + GLASS_LIST_PAGE_SIZE);
    const selectedLocalIndex = glassSelectedIndex - pageStart;
    const visibleRows = getVisibleGlassListRows(pageArticles, selectedLocalIndex);
    let rowY = 6;
    const cards = visibleRows.map((row, displayIndex) => {
        const card = new TextContainerProperty({
            xPosition: 8,
            yPosition: rowY,
            width: 560,
            height: row.height,
            zOrderIndex: displayIndex + 1,
            borderWidth: row.index === selectedLocalIndex ? 1 : 0,
            borderColor: 15,
            borderRadius: 8,
            paddingLength: 2,
            containerID: LIST_CONTAINER_ID + row.index,
            containerName: `${LIST_CONTAINER_NAME}-${row.index + 1}`,
            content: glassNewsListItem(row.article),
            isEventCapture: 0,
        });
        rowY += row.height + 4;
        return card;
    });
    cards.push(new TextContainerProperty({
        xPosition: 8,
        yPosition: 6,
        width: 560,
        height: 276,
        zOrderIndex: cards.length + 1,
        borderWidth: 0,
        paddingLength: 0,
        containerID: LIST_INPUT_CONTAINER_ID,
        containerName: "news-list-input",
        content: "",
        isEventCapture: 1,
    }));
    if (isInitial || !glassPageCreated) {
        const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
            containerTotalNum: cards.length,
            textObject: cards,
        }));
        glassPageCreated = result === 0;
        glassRenderedMode = glassPageCreated ? "list" : null;
        glassRenderedListType = glassPageCreated ? "cards" : null;
        if (!glassPageCreated) console.error("Could not create the G2 article list.", result);
        return;
    }
    const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer({
        containerTotalNum: cards.length,
        textObject: cards,
    }));
    if (!rebuilt) console.error("Could not rebuild the G2 article list.");
    else {
        glassRenderedMode = "list";
        glassRenderedListType = "cards";
    }
}

async function showGlassArticle(articleId: string): Promise<void> {
    glassMode = "article";
    glassArticleId = articleId;
    glassBodyPage = 0;
    await renderGlasses();
}

async function handleGlassListInput(eventType: OsEventTypeList | undefined): Promise<void> {
    if (eventType === OsEventTypeList.LONG_PRESS_EVENT) {
        await refreshFeeds(true);
        return;
    }
    const articles = getVisibleArticles();
    if (!articles.length) return;
    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
        glassSelectedIndex = Math.min(articles.length - 1, glassSelectedIndex + 1);
        await renderGlasses();
        return;
    }
    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
        glassSelectedIndex = Math.max(0, glassSelectedIndex - 1);
        await renderGlasses();
        return;
    }
    if (eventType === OsEventTypeList.CLICK_EVENT || eventType === undefined) {
        const article = articles[glassSelectedIndex];
        if (article) await showGlassArticle(article.id);
    }
}

async function moveGlassBody(direction: -1 | 1): Promise<void> {
    const article = state.articles.find((item) => item.id === glassArticleId);
    if (!article) return;
    const pages = getGlassArticlePages(article);
    glassBodyPage = Math.max(0, Math.min(pages.length - 1, glassBodyPage + direction));
    await renderGlasses();
}

function glassArticleContent(article: Article, pageIndex: number): string {
    const heading = glassArticleHeader(article);
    const pages = getGlassArticlePages(article);
    const page = Math.max(0, Math.min(pages.length - 1, pageIndex));
    return `${heading}${pages[page] ?? ""}`;
}

function getGlassArticlePages(article: Article): string[] {
    return splitTextIntoDisplayPages(getArticleBody(article), GLASS_BODY_LINE_WIDTH, GLASS_BODY_PAGE_LINES);
}

function glassEmptyListContent(): string {
    if (glassRefreshStatus) return `${t("noNews")}\n${glassRefreshStatus}`;
    return `${t("noNews")}\n${t("registerPhone")}`;
}

function getArticleBody(article: Article): string {
    if (!article.body || article.body === "本文がありません。元記事を開いてご確認ください。") return t("bodyUnavailable");
    return article.body;
}

function getArticleTitle(article: Article): string {
    if (!article.title || article.title === "タイトルなし") return t("untitled");
    return article.title;
}

function glassNewsListItem(article: Article): string {
    const metadata = `▤ ${truncateToDisplayWidth(article.feedTitle || "RSS", 18)}`;
    const date = formatDate(article.publishedAt);
    const spaces = Math.max(1, 38 - displayWidth(metadata) - displayWidth(date));
    const title = truncateToDisplayWidth(getArticleTitle(article), GLASS_LIST_TITLE_MAX_WIDTH);
    return `${metadata}${" ".repeat(spaces)}${date}\n${title}`;
}

function glassArticleHeader(article: Article): string {
    const heading = `▤ ${truncateToDisplayWidth(getArticleTitle(article), 26)}`;
    const date = formatDate(article.publishedAt);
    const spaces = Math.max(1, 39 - displayWidth(heading) - displayWidth(date));
    return `${heading}${" ".repeat(spaces)}${date}\n\n`;
}

function displayWidth(value: string): number {
    return Array.from(value).reduce((width, character) => {
        return width + (/^[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}]$/u.test(character) ? 2 : 1);
    }, 0);
}

function truncateToDisplayWidth(value: string, widthLimit: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    const characters: string[] = [];
    let currentWidth = 0;
    for (const character of normalized) {
        const characterWidth = displayWidth(character);
        if (currentWidth + characterWidth > Math.max(0, widthLimit)) break;
        characters.push(character);
        currentWidth += characterWidth;
    }
    if (characters.length === Array.from(normalized).length) return characters.join("");
    while (characters.length && currentWidth + 2 > Math.max(0, widthLimit)) {
        currentWidth -= displayWidth(characters.pop()!);
    }
    return currentWidth + 2 <= Math.max(0, widthLimit) ? `${characters.join("")}…` : characters.join("");
}

function getVisibleGlassListRows(articles: Article[], selectedIndex: number): Array<{ article: Article; index: number; height: number }> {
    const visibleCount = Math.min(GLASS_LIST_VISIBLE_COUNT, articles.length);
    const start = Math.min(
        Math.max(0, selectedIndex - Math.floor(visibleCount / 2)),
        Math.max(0, articles.length - visibleCount),
    );
    return articles.slice(start, start + visibleCount).map((article, index) => ({
        article,
        index: start + index,
        height: GLASS_LIST_ROW_HEIGHT,
    }));
}

async function saveState(): Promise<void> {
    saveLocalState();
    if (!bridge) return;
    try {
        await bridge.setLocalStorage(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error("Could not save Even Hub storage.", error);
    }
}

function loadLocalState(): SavedState {
    try {
        return parseSavedState(localStorage.getItem(STORAGE_KEY) ?? "");
    } catch {
        return { ...EMPTY_STATE };
    }
}

function loadProxyUrl(): string {
    try {
        return localStorage.getItem(PROXY_STORAGE_KEY)?.trim() ?? "";
    } catch {
        return "";
    }
}

function saveLocalState(): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error("Could not save local storage.", error);
    }
}

function parseSavedState(raw: string): SavedState {
    try {
        const parsed = JSON.parse(raw) as Partial<SavedState>;
        return {
            feeds: Array.isArray(parsed.feeds) ? parsed.feeds : [],
            articles: Array.isArray(parsed.articles) ? parsed.articles : [],
            lastUpdatedAt: typeof parsed.lastUpdatedAt === "string" ? parsed.lastUpdatedAt : "",
        };
    } catch {
        return { ...EMPTY_STATE };
    }
}

function getInitialUiLanguage(): UiLanguage {
    return getUrlLanguageOverride() ?? readStoredUiLanguage() ?? "en";
}

function getUrlLanguageOverride(): UiLanguage | null {
    return parseUiLanguage(new URLSearchParams(window.location.search).get("lang"));
}

function readStoredUiLanguage(): UiLanguage | null {
    try {
        const value = localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
        return isUiLanguage(value) ? value : null;
    } catch {
        return null;
    }
}

function mergeStates(first: SavedState, second: SavedState): SavedState {
    const feeds = new Map<string, Feed>();
    for (const feed of [...first.feeds, ...second.feeds]) feeds.set(feed.url, feed);
    const feedIds = new Map([...feeds.values()].map((feed) => [feed.url, feed.id]));
    const oldUrlById = new Map([...first.feeds, ...second.feeds].map((feed) => [feed.id, feed.url]));
    const articles = [...first.articles, ...second.articles].map((article) => {
        const feedUrl = oldUrlById.get(article.feedId);
        return feedUrl && feedIds.has(feedUrl) ? { ...article, feedId: feedIds.get(feedUrl)! } : article;
    });
    return {
        feeds: [...feeds.values()].slice(0, MAX_FEEDS),
        articles: mergeArticles([], articles),
        lastUpdatedAt: first.lastUpdatedAt > second.lastUpdatedAt ? first.lastUpdatedAt : second.lastUpdatedAt,
    };
}

function mergeArticles(existing: Article[], incoming: Article[]): Article[] {
    const articlesById = new Map<string, Article>();
    for (const article of [...existing, ...incoming]) articlesById.set(article.id, article);
    return [...articlesById.values()].sort(compareArticles).slice(0, MAX_ARTICLES);
}

function compareArticles(left: { publishedAt: string }, right: { publishedAt: string }): number {
    return (Date.parse(right.publishedAt) || 0) - (Date.parse(left.publishedAt) || 0);
}

function setFeedMessage(message: string, type: "success" | "error" | "loading"): void {
    feedMessage.textContent = message;
    feedMessage.className = `inline-message ${type}`;
}

function showToast(message: string): void {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function getFetchErrorMessage(error: unknown): string {
    if (error instanceof DOMException && error.name === "AbortError") return t("fetchTimeout");
    if (error instanceof Error && error.message.startsWith("http:")) return t("httpError", { status: error.message.slice(5) });
    if (error instanceof Error && error.message === "invalid-xml") return t("invalidXml");
    if (error instanceof Error && error.message === "empty-feed") return t("emptyFeed");
    if (error instanceof Error && error.message === "proxy-not-configured") return t("proxyNotConfigured");
    if (error instanceof Error && error.message === "proxy-error") return t("proxyError");
    return t("genericFetchError");
}

function childText(parent: Element, names: string[]): string {
    for (const name of names) {
        const child = Array.from(parent.children).find((element) => element.localName.toLowerCase() === name.toLowerCase());
        const value = child?.textContent?.trim();
        if (value) return value;
    }
    return "";
}

function descendantText(parent: Element, names: string[]): string {
    for (const name of names) {
        const element = Array.from(parent.getElementsByTagName("*"))
            .find((child) => child.localName.toLowerCase() === name.toLowerCase());
        const value = element?.textContent?.trim();
        if (value) return value;
    }
    return "";
}

function htmlToText(value: string): string {
    if (!value) return "";
    const documentNode = new DOMParser().parseFromString(value, "text/html");
    return (documentNode.body.textContent ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/[\t ]+\n/g, "\n")
        .replace(/\n[\t ]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function normalizeDate(value: string): string {
    const date = value ? new Date(value) : new Date(0);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function resolveUrl(value: string, base: string): string {
    try {
        return new URL(value, base).href;
    } catch {
        return base;
    }
}

function hostName(value: string): string {
    try {
        return new URL(value).hostname.replace(/^www\./, "");
    } catch {
        return value;
    }
}

function generateId(): string {
    return typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getTime() === 0) return t("unknownDate");
    const parts = Object.fromEntries(LOCAL_DATE_FORMATTER.formatToParts(date).map(({ type, value }) => [type, value]));
    return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function excerpt(value: string, length: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > length ? `${normalized.slice(0, length).trimEnd()}…` : normalized;
}

function splitTextIntoDisplayPages(value: string, lineWidth: number, pageLineCount: number): string[] {
    const text = value.trim();
    if (!text) return [t("bodyUnavailable")];
    const lines: string[] = [];
    const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n+/u);
    for (const paragraph of paragraphs) {
        const words = paragraph.trim().split(/\s+/u).filter(Boolean);
        if (!words.length) continue;
        if (lines.length) lines.push("");
        let line = "";
        for (const word of words) {
            const wordWidth = displayWidth(word);
            if (wordWidth > lineWidth) {
                if (line) {
                    lines.push(line);
                    line = "";
                }
                let fragment = "";
                for (const character of word) {
                    if (displayWidth(fragment) + displayWidth(character) > lineWidth) {
                        lines.push(fragment);
                        fragment = "";
                    }
                    fragment += character;
                }
                line = fragment;
                continue;
            }
            const nextLine = line ? `${line} ${word}` : word;
            if (displayWidth(nextLine) > lineWidth) {
                lines.push(line);
                line = word;
            } else {
                line = nextLine;
            }
        }
        if (line) lines.push(line);
    }
    const pages: string[] = [];
    for (let start = 0; start < lines.length; start += pageLineCount) {
        const pageLines = lines.slice(start, start + pageLineCount);
        while (pageLines.at(-1) === "") pageLines.pop();
        while (pageLines[0] === "") pageLines.shift();
        if (pageLines.length) pages.push(pageLines.filter(Boolean).join(" "));
    }
    return pages.length ? pages : [text];
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[character]!);
}

function escapeAttribute(value: string): string {
    return escapeHtml(value);
}
