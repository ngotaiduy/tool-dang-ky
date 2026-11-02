/*
 * Runs inside the Google Form page (via the extension, bookmarklet or DevTools console).
 * Must stay self-contained: app.js and chrome.scripting serialise it with Function.prototype.toString().
 * Only fills the page currently displayed; never navigates or submits.
 */
async function hskFormFiller(data) {
  const MORSE = {
    '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F', '--.': 'G',
    '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N',
    '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T', '..-': 'U',
    '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y', '--..': 'Z'
  };

  const RULES = [
    { key: 'name', kind: 'text', label: 'Họ tên', match: t => t === 'NAME' },
    { key: 'chineseName', kind: 'text', label: 'Tên tiếng Trung', match: t => t === 'CHNAME' },
    { key: 'idType', kind: 'choice', label: 'Loại giấy tờ', match: t => t.startsWith('LOẠI GIẤY TỜ') },
    { key: 'idNumber', kind: 'text', label: 'Số CCCD', match: t => t === 'IDNUM' },
    { key: 'passportNumber', kind: 'text', label: 'Số hộ chiếu', match: t => t === 'PPNUM' },
    { key: 'gender', kind: 'choice', label: 'Giới tính', match: t => t.startsWith('GIỚI TÍNH') },
    { key: 'birthDate', kind: 'text', label: 'Ngày sinh', match: t => t === 'BIRTHDATE' },
    { key: 'nationality', kind: 'choice', label: 'Quốc tịch', match: t => t.startsWith('QUỐC TỊCH') },
    { key: 'motherTongue', kind: 'choice', label: 'Tiếng mẹ đẻ', match: t => t.startsWith('TIẾNG MẸ ĐẺ') },
    { key: 'email', kind: 'text', label: 'Email', match: t => t.startsWith('EMAIL |') },
    { key: 'phone', kind: 'text', label: 'Số điện thoại', match: t => t === 'PHONENUM' },
    { key: 'studyDuration', kind: 'choice', label: 'Thời gian học', match: t => t.startsWith('THỜI GIAN HỌC') },
    { key: 'paymentMethod', kind: 'choice', label: 'Phương thức chuyển khoản', match: t => t.startsWith('PHƯƠNG THỨC CHUYỂN KHOẢN') },
    { key: 'accountNumber', kind: 'text', label: 'Số tài khoản', match: t => t.startsWith('SỐ TÀI KHOẢN') },
    { key: 'accountHolder', kind: 'text', label: 'Chủ tài khoản', match: t => t.startsWith('CHỦ TÀI KHOẢN') },
    { key: 'bank', kind: 'choice', label: 'Ngân hàng', match: t => t.startsWith('TÊN NGÂN HÀNG') },
    { key: 'pledge', kind: 'pledge', label: 'Cam kết', match: t => t.startsWith('TÔI CAM KẾT') }
  ];

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = s => (s || '').normalize('NFC').replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
  const upper = s => clean(s).toUpperCase();
  const optionKey = s => upper(s).split('|')[0].trim();
  const valueOf = el => el.getAttribute('data-value') ?? el.getAttribute('data-answer-value') ?? el.getAttribute('aria-label') ?? '';
  const isVisible = el => el.getBoundingClientRect().height > 0;

  const decodeTitle = text => {
    const t = clean(text);
    if (/^[.\-\s]+$/.test(t)) {
      return t.split(' ').map(code => MORSE[code] || '?').join('');
    }
    return t.toUpperCase();
  };

  const findOption = (elements, value) => {
    const target = upper(value);
    const key = optionKey(value);
    return elements.find(el => upper(valueOf(el)) === target)
      || elements.find(el => key && optionKey(valueOf(el)) === key);
  };

  const setText = (input, value) => {
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    input.focus();
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
  };

  // Google's dropdown options ignore element.click(); they need a full pointer sequence.
  const pressMouse = el => {
    const rect = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, view: window, button: 0, clientX: rect.x + 5, clientY: rect.y + 5 };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
      const EventType = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new EventType(type, init));
    });
  };

  const check = el => {
    if (el.getAttribute('aria-checked') !== 'true') el.click();
  };

  const chooseRadio = async (item, value) => {
    const radios = [...item.querySelectorAll('[role=radio], [role=checkbox]')];
    const other = radios.find(r => valueOf(r) === '__other_option__');
    const match = findOption(radios.filter(r => r !== other), value);
    if (match) {
      check(match);
      return true;
    }
    if (!other) return false;
    check(other);
    await wait(200);
    const otherInput = item.querySelector('input[type=text]');
    if (!otherInput) return false;
    setText(otherInput, value);
    return true;
  };

  const waitFor = async (condition, timeout = 1200) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (condition()) return true;
      await wait(50);
    }
    return condition();
  };

  const isExpanded = listbox => listbox.getAttribute('aria-expanded') === 'true';

  const closeDropdown = listbox => {
    if (!isExpanded(listbox)) return;
    listbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  };

  // The listbox only reacts to clicks on its inner trigger; try the known targets until it opens.
  // Clicking the next target while the popup is still animating open would close it again.
  const openDropdown = async listbox => {
    const targets = [
      listbox.querySelector('[jsname=LgbsSe]'),
      listbox.querySelector('[role=option][aria-selected=true]'),
      listbox
    ].filter(Boolean);
    for (const target of targets) {
      if (isExpanded(listbox)) return true;
      target.click();
      if (await waitFor(() => isExpanded(listbox))) return true;
    }
    return false;
  };

  const chooseDropdown = async (item, value) => {
    const listbox = item.querySelector('[role=listbox]');
    const selected = listbox.querySelector('[aria-selected=true][data-value]');
    if (selected && findOption([selected], value)) {
      closeDropdown(listbox);
      return true;
    }

    if (!(await openDropdown(listbox))) return false;

    const visibleOptions = () => [...item.querySelectorAll('[role=option]')].filter(o => valueOf(o) && isVisible(o));
    await waitFor(() => visibleOptions().length > 0);
    const match = findOption(visibleOptions(), value);
    if (match) {
      pressMouse(match);
      await waitFor(() => !isExpanded(listbox));
    }
    closeDropdown(listbox);
    await wait(300);
    return !!match;
  };

  const choose = (item, value) => (item.querySelector('[role=listbox]') ? chooseDropdown(item, value) : chooseRadio(item, value));

  const choosePledge = item => {
    const choices = [...item.querySelectorAll('[role=radio], [role=checkbox]')];
    const vietnamese = choices.find(c => upper(valueOf(c)).startsWith('TÔI'));
    const target = vietnamese || choices[0];
    if (!target) return false;
    check(target);
    return true;
  };

  const hasControls = item => !!item.querySelector('input:not([type=hidden]), textarea, [role=radio], [role=checkbox], [role=listbox], [role=button]');

  const showReport = report => {
    const old = document.getElementById('hsk-filler-report');
    if (old) old.remove();

    const box = document.createElement('div');
    box.id = 'hsk-filler-report';
    Object.assign(box.style, {
      position: 'fixed', top: '16px', right: '16px', zIndex: 2147483647, maxWidth: '360px',
      padding: '14px 16px', background: '#ffffff', color: '#1f2937', borderRadius: '10px',
      boxShadow: '0 10px 30px rgba(0,0,0,.25)', font: '14px/1.5 Arial, sans-serif', cursor: 'pointer'
    });

    const addLine = (text, color, bold) => {
      const line = document.createElement('div');
      line.textContent = text;
      line.style.color = color;
      if (bold) line.style.fontWeight = '700';
      box.appendChild(line);
    };

    addLine('Tool điền form HSK', '#1d4ed8', true);
    report.filled.forEach(t => addLine('✔ ' + t, '#15803d'));
    report.failed.forEach(t => addLine('✘ Không điền được: ' + t, '#b91c1c'));
    report.manual.forEach(t => addLine('✎ Tự điền: ' + t, '#b45309'));
    if (!report.filled.length && !report.failed.length && !report.manual.length) {
      addLine('Trang này không có trường nào cần điền.', '#4b5563');
    }
    addLine('Kiểm tra lại rồi tự bấm "Tiếp" / "Gửi". (Bấm để đóng)', '#4b5563');

    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  };

  const report = { filled: [], failed: [], manual: [] };

  const emailCheckbox = [...document.querySelectorAll('[role=checkbox]')]
    .find(c => !c.closest('[role=listitem]') && (c.getAttribute('aria-label') || '').includes('@'));
  if (emailCheckbox) {
    check(emailCheckbox);
    report.filled.push('Lưu email Google vào câu trả lời');
  }

  // The verification question's wording changes between forms, so it is located by its section title instead.
  const isVerificationPage = [...document.querySelectorAll('[role=heading]')]
    .some(h => upper(h.innerText).includes('CÂU HỎI XÁC THỰC'));

  for (const item of document.querySelectorAll('[role=listitem]')) {
    const heading = item.querySelector('[role=heading]');
    if (!heading || !hasControls(item)) continue;

    const title = decodeTitle(heading.innerText);
    const rule = RULES.find(r => r.match(title));
    const textInput = item.querySelector('input[type=text], textarea');
    if (!rule && isVerificationPage && textInput && data.verificationAnswer) {
      setText(textInput, data.verificationAnswer);
      report.filled.push('Câu hỏi xác thực');
      continue;
    }
    if (!rule) {
      report.manual.push(clean(heading.innerText).slice(0, 60));
      continue;
    }

    let ok = false;
    if (rule.kind === 'pledge') {
      ok = choosePledge(item);
    } else {
      const value = data[rule.key];
      if (!value) continue;
      if (rule.kind === 'text') {
        const input = item.querySelector('input:not([type=hidden]), textarea');
        if (input) {
          setText(input, value);
          ok = true;
        }
      } else {
        ok = await choose(item, value);
      }
    }

    (ok ? report.filled : report.failed).push(rule.label);
  }

  showReport(report);
  return report;
}
