/*
 * Extension service worker. Watches the Facebook post until the chosen form link
 * appears, opens it, and fills every page of that form when it loads.
 * Never clicks "Tiếp" or "Gửi": the user reviews, uploads files and submits.
 */
importScripts('form-filler.js', 'post-links.js');

const START_BEFORE_MS = 3 * 60 * 1000;
const POLL_MS = 3000;
const STOP_AFTER_MS = 3 * 60 * 60 * 1000;
const RENDER_WAIT_MS = 15000;
const LOAD_TIMEOUT_MS = 20000;
const ALARM_START = 'hsk-start';
const ALARM_WATCHDOG = 'hsk-watchdog';
const FORM_URL = /^https:\/\/docs\.google\.com\/forms\//;
const FACEBOOK_URL = /^https:\/\/(www|web|m)\.facebook\.com\//;

let polling = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const getWatch = async () => (await chrome.storage.local.get('watch')).watch || null;

const updateWatch = async changes => {
  const watch = { ...(await getWatch()), ...changes };
  await chrome.storage.local.set({ watch });
  return watch;
};

const getFillTabs = async () => (await chrome.storage.session.get('fillTabs')).fillTabs || [];

const addFillTab = async tabId => {
  const tabs = await getFillTabs();
  if (!tabs.includes(tabId)) await chrome.storage.session.set({ fillTabs: [...tabs, tabId] });
};

const stopAlarms = () => Promise.all([chrome.alarms.clear(ALARM_START), chrome.alarms.clear(ALARM_WATCHDOG)]);

const stopWatch = async message => {
  await stopAlarms();
  await updateWatch({ status: 'stopped', message });
};

const waitForLoad = tabId => new Promise(resolve => {
  const done = () => {
    chrome.tabs.onUpdated.removeListener(listener);
    clearTimeout(timer);
    resolve();
  };
  const listener = (id, info) => {
    if (id === tabId && info.status === 'complete') done();
  };
  const timer = setTimeout(done, LOAD_TIMEOUT_MS);
  chrome.tabs.onUpdated.addListener(listener);
});

const loadPostTab = async watch => {
  const existing = watch.tabId ? await chrome.tabs.get(watch.tabId).catch(() => null) : null;
  if (existing) {
    const loaded = waitForLoad(existing.id);
    if (FACEBOOK_URL.test(existing.url || '')) await chrome.tabs.reload(existing.id);
    else await chrome.tabs.update(existing.id, { url: watch.postUrl });
    await loaded;
    return existing.id;
  }

  const tab = await chrome.tabs.create({ url: watch.postUrl, active: true });
  await updateWatch({ tabId: tab.id });
  await waitForLoad(tab.id);
  return tab.id;
};

const readPostLinks = async (tabId, labels) => {
  const deadline = Date.now() + RENDER_WAIT_MS;
  let result = { ready: false, all: [], labelled: [] };
  while (Date.now() < deadline) {
    try {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: collectFormLinks, args: [labels] });
      if (injection && injection.result) result = injection.result;
    } catch (error) {
      // The page is still navigating; try again.
    }
    if (result.ready || result.labelled.length) break;
    await sleep(300);
  }
  return result;
};

const checkPost = async () => {
  const watch = await getWatch();
  const tabId = await loadPostTab(watch);
  const result = await readPostLinks(tabId, watch.labels);
  const tab = await chrome.tabs.get(tabId).catch(() => null);

  let message = '';
  if (tab && /\/login|checkpoint/.test(tab.url || '')) message = 'Facebook đang yêu cầu đăng nhập. Hãy đăng nhập Facebook trong tab bài viết.';
  else if (!result.ready && !result.labelled.length) message = 'Chưa đọc được nội dung bài viết. Kiểm tra lại link bài viết.';

  const current = await getWatch();
  await updateWatch({
    lastCheck: Date.now(),
    checks: (current.checks || 0) + 1,
    linksInPost: result.all,
    message
  });
  return result.labelled[0] || null;
};

const fillTab = async tabId => {
  const { profile } = await chrome.storage.local.get('profile');
  if (!profile) return;
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: hskFormFiller,
    args: [profile]
  });
  if (injection && injection.result) await chrome.storage.local.set({ lastFill: { at: Date.now(), ...injection.result } });
};

const openForm = async url => {
  await stopAlarms();
  await updateWatch({ status: 'found', foundUrl: url, message: '' });

  const tab = await chrome.tabs.create({ url, active: true });
  await addFillTab(tab.id);
  await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });

  chrome.notifications.create('hsk-found', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'Đã có link đăng ký!',
    message: 'Tool đã mở form và đang tự điền. Kiểm tra lại rồi tự bấm "Tiếp" / "Gửi".',
    priority: 2,
    requireInteraction: true
  });
};

const isActive = watch => watch && watch.status === 'watching';

const pollLoop = async () => {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      const watch = await getWatch();
      if (!isActive(watch)) return;
      if (!watch.test && Date.now() > watch.openAt + STOP_AFTER_MS) {
        await stopWatch('Đã quá 3 giờ sau giờ cập nhật mà chưa thấy link. Tool đã dừng.');
        return;
      }

      const link = await checkPost();
      if (!isActive(await getWatch())) return;
      if (link) {
        await openForm(link);
        return;
      }
      await sleep(POLL_MS);
    }
  } catch (error) {
    await updateWatch({ message: 'Lỗi: ' + error.message + '. Tool sẽ thử lại.' });
  } finally {
    polling = false;
  }
};

const startWatch = async config => {
  await stopAlarms();
  const previous = await getWatch();
  const startAt = config.test ? Date.now() : config.openAt - START_BEFORE_MS;

  await chrome.storage.local.set({
    watch: {
      ...config,
      startAt,
      status: 'checking',
      tabId: previous ? previous.tabId : null,
      checks: 0,
      lastCheck: null,
      linksInPost: [],
      foundUrl: null,
      message: ''
    }
  });

  const link = await checkPost();
  if ((await getWatch()).status !== 'checking') return;
  if (link) {
    await openForm(link);
    return;
  }

  if (Date.now() < startAt) {
    await updateWatch({ status: 'waiting' });
    chrome.alarms.create(ALARM_START, { when: startAt });
  } else {
    await updateWatch({ status: 'watching' });
  }
  chrome.alarms.create(ALARM_WATCHDOG, { periodInMinutes: 0.5 });
  pollLoop();
};

// Both alarms only (re)start the loop; the watchdog revives it if the worker was stopped.
chrome.alarms.onAlarm.addListener(async () => {
  const watch = await getWatch();
  if (watch && watch.status === 'waiting' && Date.now() >= watch.startAt) await updateWatch({ status: 'watching' });
  if (isActive(await getWatch())) pollLoop();
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'start-watch') {
    startWatch(message.config).catch(error => stopWatch('Lỗi: ' + error.message));
  } else if (message.type === 'stop-watch') {
    stopWatch('Bạn đã dừng tool.');
  } else if (message.type === 'form-ready' && sender.tab) {
    getFillTabs().then(tabs => {
      if (tabs.includes(sender.tab.id)) fillTab(sender.tab.id);
    });
  }
});

// Clicking the toolbar icon on any Google Form fills it; elsewhere it opens the tool page.
chrome.action.onClicked.addListener(async tab => {
  if (FORM_URL.test(tab.url || '')) {
    await addFillTab(tab.id);
    await fillTab(tab.id);
    return;
  }
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const tabs = await getFillTabs();
  if (tabs.includes(tabId)) await chrome.storage.session.set({ fillTabs: tabs.filter(id => id !== tabId) });
});

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
