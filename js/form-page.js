/*
 * Content script on Google Form pages. Tells the extension when the questions
 * have rendered; the extension decides whether this tab should be filled.
 */
(function () {
  const TIMEOUT = 15000;
  const start = Date.now();

  const timer = setInterval(() => {
    if (document.querySelector('[role=listitem]')) {
      clearInterval(timer);
      chrome.runtime.sendMessage({ type: 'form-ready' });
    } else if (Date.now() - start > TIMEOUT) {
      clearInterval(timer);
    }
  }, 200);
})();
