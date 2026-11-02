(function () {
  const STORAGE_KEY = 'hsk-form-helper';
  const OTHER = '__other__';
  const ID_TYPE_CCCD = 'CCCD   |   身份证';
  const PAYMENT_AT_BANK = 'CHUYỂN KHOẢN TẠI NGÂN HÀNG | 银行柜台转账';
  const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'icloud.com', 'qq.com', '163.com', 'outlook.com', 'naver.com', 'hotmail.com'];
  const IS_EXTENSION = !!(window.chrome && chrome.runtime && chrome.runtime.id);
  const TEST_TARGET = '__test__';
  const TEST_LABELS = ['ĐIỀN THỬ', 'MẪU FORM'];

  const STATUS_TEXT = {
    checking: 'Đang mở bài viết để kiểm tra...',
    waiting: 'Đang chờ đến giờ canh (bắt đầu 3 phút trước giờ cập nhật)',
    watching: 'Đang tải lại bài viết mỗi 3 giây để canh link',
    found: 'Đã tìm thấy link, đã mở form và tự điền',
    stopped: 'Đã dừng'
  };

  const LABELS = {
    name: 'Họ và tên',
    chineseName: 'Tên tiếng Trung',
    idType: 'Loại giấy tờ',
    idNumber: 'Số CCCD',
    passportNumber: 'Số hộ chiếu',
    gender: 'Giới tính',
    birthDate: 'Ngày sinh',
    nationality: 'Quốc tịch',
    motherTongue: 'Tiếng mẹ đẻ',
    email: 'Email',
    phone: 'Số điện thoại',
    studyDuration: 'Thời gian học',
    paymentMethod: 'Phương thức chuyển khoản',
    accountNumber: 'Số tài khoản',
    accountHolder: 'Chủ tài khoản',
    bank: 'Ngân hàng',
    verificationAnswer: 'Đáp án câu hỏi xác thực'
  };

  const form = document.getElementById('registration-form');
  const output = document.getElementById('filler-output');
  const bookmarklet = document.getElementById('bookmarklet-link');
  const summary = document.getElementById('field-summary');

  let currentScript = '';

  const collapseSpaces = s => s.replace(/\s+/g, ' ').trim();

  const toUpperAscii = s => collapseSpaces(
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  ).toUpperCase();

  const field = name => form.elements[name];

  const readRaw = () => {
    const raw = {};
    Array.from(form.elements).forEach(el => {
      if (el.name) raw[el.name] = el.value;
    });
    return raw;
  };

  const writeRaw = raw => {
    Object.keys(raw).forEach(name => {
      const el = field(name);
      if (el && typeof raw[name] === 'string') el.value = raw[name];
    });
  };

  const choiceWithOther = (raw, name) => (raw[name] === OTHER ? collapseSpaces(raw[name + 'Other'] || '') : raw[name]);

  const normalize = raw => {
    const isCccd = raw.idType === ID_TYPE_CCCD;
    const payAtBank = raw.paymentMethod === PAYMENT_AT_BANK;

    return {
      name: toUpperAscii(raw.name),
      chineseName: collapseSpaces(raw.chineseName),
      idType: raw.idType,
      idNumber: isCccd ? raw.idNumber.replace(/\D/g, '') : '',
      passportNumber: isCccd ? '' : raw.passportNumber.replace(/\s/g, '').toUpperCase(),
      gender: raw.gender,
      birthDate: raw.birthDate,
      nationality: choiceWithOther(raw, 'nationality'),
      motherTongue: choiceWithOther(raw, 'motherTongue'),
      email: raw.email.trim().toLowerCase(),
      phone: raw.phone.replace(/[\s.\-()]/g, ''),
      studyDuration: raw.studyDuration,
      paymentMethod: raw.paymentMethod,
      accountNumber: payAtBank ? '0' : raw.accountNumber.replace(/\s/g, ''),
      accountHolder: toUpperAscii(raw.accountHolder),
      bank: choiceWithOther(raw, 'bank'),
      verificationAnswer: (raw.verificationAnswer || '').replace(/[\s.,]/g, '')
    };
  };

  const validateEmail = email => {
    const match = /^([a-z0-9._%+-]+)@([a-z0-9.-]+)$/.exec(email);
    if (!match) return 'Email không hợp lệ.';
    if ((match[1].match(/\./g) || []).length > 1) return 'Phần trước @ chỉ được có tối đa một dấu ".".';
    if (!EMAIL_DOMAINS.includes(match[2])) return 'Tên miền không nằm trong danh sách được chấp nhận.';
    return '';
  };

  const validate = data => {
    const errors = {};

    if (!data.name) errors.name = 'Vui lòng nhập họ tên.';
    else if (!/^[A-Z]+( [A-Z]+)*$/.test(data.name)) errors.name = 'Họ tên chỉ gồm chữ cái, không có ký tự đặc biệt.';

    if (data.idType === ID_TYPE_CCCD) {
      if (!/^\d{12}$/.test(data.idNumber)) errors.idNumber = 'Số CCCD phải gồm đúng 12 chữ số.';
    } else if (!/^[A-Z0-9]{6,}$/.test(data.passportNumber)) {
      errors.passportNumber = 'Số hộ chiếu chỉ gồm chữ và số, tối thiểu 6 ký tự.';
    }

    if (!data.gender) errors.gender = 'Vui lòng chọn giới tính.';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.birthDate)) errors.birthDate = 'Vui lòng chọn ngày sinh.';

    if (!data.nationality) errors.nationality = 'Vui lòng nhập quốc tịch.';
    if (!data.motherTongue) errors.motherTongue = 'Vui lòng nhập tiếng mẹ đẻ.';
    if (!data.studyDuration) errors.studyDuration = 'Vui lòng chọn thời gian học.';

    const emailError = validateEmail(data.email);
    if (emailError) errors.email = emailError;

    if (!/^(0\d{9}|\+84\d{9})$/.test(data.phone)) errors.phone = 'Số điện thoại phải dạng 0xxxxxxxxx hoặc +84xxxxxxxxx.';

    if (!/^\d+$/.test(data.accountNumber)) errors.accountNumber = 'Số tài khoản chỉ gồm chữ số.';

    if (!data.accountHolder) errors.accountHolder = 'Vui lòng nhập chủ tài khoản.';
    else if (!/^[A-Z ]+$/.test(data.accountHolder)) errors.accountHolder = 'Chủ tài khoản chỉ gồm chữ cái.';

    if (!data.bank) errors.bank = 'Vui lòng chọn hoặc nhập ngân hàng.';

    if (data.verificationAnswer && !/^\d+$/.test(data.verificationAnswer)) {
      errors.verificationAnswer = 'Đáp án chỉ gồm chữ số.';
    }

    return errors;
  };

  const normalizeWatch = raw => {
    const test = raw.examTarget === TEST_TARGET;
    const label = test ? '' : choiceWithOther(raw, 'examTarget');
    const postUrl = raw.postUrl.trim();
    return {
      postUrl: postUrl && !/^https?:\/\//.test(postUrl) ? 'https://' + postUrl : postUrl,
      openAt: raw.openAt ? new Date(raw.openAt).getTime() : NaN,
      test,
      labels: test ? TEST_LABELS : [label].filter(Boolean),
      targetName: test ? 'Form điền thử (kiểm thử tool)' : label
    };
  };

  const validateWatch = watch => {
    const errors = {};
    if (!/^https:\/\/(www\.|web\.|m\.)?facebook\.com\/\S+/.test(watch.postUrl)) {
      errors.postUrl = 'Hãy dán link bài viết Facebook, VD: https://www.facebook.com/share/p/...';
    }
    if (!watch.labels.length) errors.examTarget = 'Vui lòng chọn cấp HSK hoặc kiểm thử.';
    if (!watch.test && Number.isNaN(watch.openAt)) errors.openAt = 'Vui lòng chọn ngày giờ bài viết cập nhật link.';
    return errors;
  };

  const showErrors = errors => {
    form.querySelectorAll('[data-error-for]').forEach(el => {
      const message = errors[el.dataset.errorFor] || '';
      el.textContent = message;
      const input = field(el.dataset.errorFor);
      if (input) input.classList.toggle('form-field__input--invalid', !!message);
    });
  };

  const applyNormalizedToInputs = data => {
    ['name', 'chineseName', 'email', 'phone', 'accountHolder', 'verificationAnswer'].forEach(name => {
      field(name).value = data[name];
    });
    field('accountNumber').value = data.accountNumber;
    if (data.idType === ID_TYPE_CCCD) field('idNumber').value = data.idNumber;
    else field('passportNumber').value = data.passportNumber;
  };

  const toggleDependentFields = () => {
    form.querySelectorAll('[data-show-for-id]').forEach(el => {
      el.hidden = el.dataset.showForId !== field('idType').value;
    });

    form.querySelectorAll('[data-other-target]').forEach(select => {
      document.getElementById(select.dataset.otherTarget).hidden = select.value !== OTHER;
    });

    form.querySelectorAll('[data-hide-for-test]').forEach(el => {
      el.hidden = field('examTarget').value === TEST_TARGET;
    });

    const payAtBank = field('paymentMethod').value === PAYMENT_AT_BANK;
    field('accountNumber').readOnly = payAtBank;
    if (payAtBank) field('accountNumber').value = '0';
  };

  const applyContext = () => {
    const context = IS_EXTENSION ? 'extension' : 'web';
    document.querySelectorAll('[data-context]').forEach(el => {
      el.hidden = el.dataset.context !== context;
    });
  };

  // On GitHub Pages (owner.github.io/repo/) the download button points at the repo's latest release.
  const linkReleaseDownload = () => {
    if (!location.hostname.endsWith('.github.io')) return;
    const owner = location.hostname.split('.')[0];
    const repo = location.pathname.split('/')[1] || location.hostname;
    document.querySelectorAll('[data-release-link]').forEach(link => {
      link.href = `https://github.com/${owner}/${repo}/releases/latest/download/hsk-extension.zip`;
    });
  };

  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(readRaw()));

  const load = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (raw) writeRaw(raw);
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const copyText = async text => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const temp = document.createElement('textarea');
      temp.value = text;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      temp.remove();
    }
  };

  const flashCopied = button => {
    const original = button.textContent;
    button.textContent = 'Đã copy';
    setTimeout(() => { button.textContent = original; }, 1200);
  };

  const renderSummary = data => {
    summary.replaceChildren();
    Object.keys(LABELS).forEach(key => {
      if (!data[key]) return;

      const row = document.createElement('div');
      row.className = 'field-summary__row';

      const term = document.createElement('dt');
      term.className = 'field-summary__term';
      term.textContent = LABELS[key];

      const desc = document.createElement('dd');
      desc.className = 'field-summary__value';

      const value = document.createElement('span');
      value.className = 'field-summary__text';
      value.textContent = data[key];

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button--small';
      button.textContent = 'Copy';
      button.addEventListener('click', () => copyText(data[key]).then(() => flashCopied(button)));

      desc.append(value, button);
      row.append(term, desc);
      summary.appendChild(row);
    });
  };

  const buildFillerScript = data => `(${hskFormFiller.toString()})(${JSON.stringify(data)});`;

  const showBookmarklet = data => {
    currentScript = buildFillerScript(data);
    bookmarklet.href = 'javascript:' + encodeURIComponent(currentScript + 'void 0');
    renderSummary(data);
    output.hidden = false;
    output.scrollIntoView({ behavior: 'smooth' });
  };

  const formatTime = time => new Date(time).toLocaleString('vi-VN', { hour12: false });

  const formatCountdown = ms => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const pad = n => String(n).padStart(2, '0');
    const days = Math.floor(total / 86400);
    const clock = `${pad(Math.floor(total / 3600) % 24)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
    return days ? `${days} ngày ${clock}` : clock;
  };

  const setStatus = (key, text) => {
    const el = document.querySelector(`[data-status="${key}"]`);
    el.textContent = text || '';
    el.closest('.field-summary__row').hidden = !text;
    return el;
  };

  let watchState = null;
  let lastFillState = null;

  const renderStatus = () => {
    const watch = watchState;
    if (!watch) return;

    setStatus('state', STATUS_TEXT[watch.status] || 'Chưa bắt đầu');
    setStatus('target', watch.targetName);

    let openAtText = '';
    if (!watch.test && watch.openAt) {
      const left = watch.openAt - Date.now();
      const running = watch.status === 'waiting' || watch.status === 'watching';
      openAtText = formatTime(watch.openAt) + (running && left > 0 ? ` (còn ${formatCountdown(left)})` : '');
    }
    setStatus('openAt', openAtText);

    setStatus('lastCheck', watch.lastCheck ? `${formatTime(watch.lastCheck)} (đã kiểm tra ${watch.checks} lần)` : '');
    setStatus('foundUrl', watch.foundUrl).href = watch.foundUrl || '#';
    setStatus('message', watch.message);

    const fill = lastFillState;
    setStatus('lastFill', fill ? [
      formatTime(fill.at),
      `điền được ${fill.filled.length} mục`,
      fill.failed.length ? `không điền được: ${fill.failed.join(', ')}` : '',
      fill.manual.length ? `cần tự điền: ${fill.manual.join(', ')}` : ''
    ].filter(Boolean).join(' · ') : '');
  };

  const startWatch = async (profile, watch) => {
    await chrome.storage.local.set({ profile });
    chrome.runtime.sendMessage({ type: 'start-watch', config: watch });
    document.getElementById('watch-status').scrollIntoView({ behavior: 'smooth' });
  };

  const initExtension = async () => {
    const stored = await chrome.storage.local.get(['watch', 'lastFill']);
    watchState = stored.watch || null;
    lastFillState = stored.lastFill || null;
    renderStatus();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.watch) watchState = changes.watch.newValue || null;
      if (changes.lastFill) lastFillState = changes.lastFill.newValue || null;
      renderStatus();
    });
    setInterval(renderStatus, 1000);

    document.getElementById('stop-watch').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'stop-watch' });
    });
  };

  form.addEventListener('submit', event => {
    event.preventDefault();
    const raw = readRaw();
    const data = normalize(raw);
    const watch = IS_EXTENSION ? normalizeWatch(raw) : null;
    const errors = { ...validate(data), ...(watch ? validateWatch(watch) : {}) };
    showErrors(errors);

    if (Object.keys(errors).length) {
      output.hidden = true;
      const firstInvalid = form.querySelector('.form-field__input--invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    applyNormalizedToInputs(data);
    save();

    if (IS_EXTENSION) startWatch(data, watch);
    else showBookmarklet(data);
  });

  form.addEventListener('change', () => {
    toggleDependentFields();
    save();
  });

  form.addEventListener('input', save);

  bookmarklet.addEventListener('click', event => {
    event.preventDefault();
    alert('Hãy kéo nút này lên thanh dấu trang, rồi bấm nó khi đang mở trang form Google.');
  });

  document.getElementById('copy-script').addEventListener('click', event => {
    const button = event.currentTarget;
    copyText(currentScript).then(() => flashCopied(button));
  });

  document.getElementById('clear-data').addEventListener('click', () => {
    if (!confirm('Xoá toàn bộ thông tin đã lưu trên máy này?')) return;
    localStorage.removeItem(STORAGE_KEY);
    if (IS_EXTENSION) chrome.storage.local.remove('profile');
    form.reset();
    showErrors({});
    output.hidden = true;
    toggleDependentFields();
  });

  applyContext();
  load();
  toggleDependentFields();
  if (IS_EXTENSION) initExtension();
  else linkReleaseDownload();
})();
