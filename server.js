const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(session({
  secret: crypto.randomBytes(32).toString('hex'),
  resave: true,
  saveUninitialized: true,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.static(path.join(__dirname, 'public')));
app.post('/admin/login', loginLimiter);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const locales = require('./locales');

app.use(function(req, res, next) {
  var lang = req.session.lang || 'en';
  res.locals.lang = lang;
  res.locals.__ = function(key) {
    var translation = locales[lang] && locales[lang][key];
    return translation || locales.en[key] || key;
  };
  next();
});

app.post('/lang/:lang', function(req, res) {
  if (['en', 'sw'].includes(req.params.lang)) {
    req.session.lang = req.params.lang;
  }
  res.json({ success: true });
});

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.redirect('/admin/login');
}

const dbInit = require('./database');

async function main() {
  const db = await dbInit.init();

  function nextContributorId(eventId) {
    const count = db.prepare('SELECT COUNT(*) as cnt FROM contributors WHERE event_id = ?').get([eventId]);
    return 'CNT-' + String(count.cnt || 0).padStart(3, '0');
  }

  app.get('/admin/login', (req, res) => {
    if (req.session && req.session.isAdmin) {
      return res.redirect('/admin/dashboard');
    }
    res.render('login', { error: null });
  });

  app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    try {
      const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get([username]);
      if (admin && bcrypt.compareSync(password, admin.password_hash)) {
        req.session.isAdmin = true;
        req.session.adminId = admin.id;
        logActivity('Login', 'Admin logged in');
        return res.redirect('/admin/dashboard');
      }
      res.render('login', { error: 'Invalid username or password' });
    } catch (err) {
      res.render('login', { error: 'An error occurred' });
    }
  });

  app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
  });

  app.get('/admin/change-password', requireAuth, (req, res) => {
    const admin = db.prepare('SELECT * FROM admin WHERE id = ?').get([req.session.adminId]);
    res.render('change-password', { success: null, error: null, recoveryNotice: null, admin });
  });

  app.post('/admin/change-password', requireAuth, (req, res) => {
    const { current_password, new_password, confirm_password, recovery_code } = req.body;
    const admin = db.prepare('SELECT * FROM admin WHERE id = ?').get([req.session.adminId]);
    if (!admin || !bcrypt.compareSync(current_password, admin.password_hash)) {
      return res.render('change-password', { error: __('wrongPassword'), success: null, recoveryNotice: null, admin });
    }
    if (new_password !== confirm_password) {
      return res.render('change-password', { error: __('passwordMismatch'), success: null, recoveryNotice: null, admin });
    }
    const hash = bcrypt.hashSync(new_password, 10);
    if (recovery_code) {
      const recoveryHash = bcrypt.hashSync(recovery_code, 10);
      db.prepare('UPDATE admin SET password_hash = ?, recovery_code = ? WHERE id = ?').run([hash, recoveryHash, req.session.adminId]);
    } else {
      db.prepare('UPDATE admin SET password_hash = ? WHERE id = ?').run([hash, req.session.adminId]);
    }
    save();
    logActivity('Change Password', 'Admin password changed');
    res.render('change-password', { success: __('passwordChanged'), error: null, recoveryNotice: null, admin });
  });

  app.get('/admin/reset-password', (req, res) => {
    res.render('reset-password', { success: null, error: null });
  });

  app.post('/admin/reset-password', (req, res) => {
    const { username, recovery_code, new_password, confirm_password } = req.body;
    try {
      const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get([username]);
      if (!admin || !admin.recovery_code || !bcrypt.compareSync(recovery_code, admin.recovery_code)) {
        return res.render('reset-password', { error: __('invalidRecovery'), success: null });
      }
      if (new_password !== confirm_password) {
        return res.render('reset-password', { error: __('passwordMismatch'), success: null });
      }
      const hash = bcrypt.hashSync(new_password, 10);
      db.prepare('UPDATE admin SET password_hash = ? WHERE id = ?').run([hash, admin.id]);
      save();
      logActivity('Reset Password', 'Admin password reset via recovery code');
      res.render('reset-password', { success: __('passwordReset'), error: null });
    } catch (err) {
      res.render('reset-password', { error: __('errorOccurred'), success: null });
    }
  });

  function addNotification(eventId, type, message) {
    db.prepare('INSERT INTO notifications (event_id, type, message) VALUES (?, ?, ?)').run([eventId, type, message]);
  }

  function getUnreadCount() {
    return db.prepare("SELECT COUNT(*) as count FROM notifications WHERE is_read = 0").get([]).count;
  }

  function logActivity(action, details) {
    db.prepare('INSERT INTO activity_log (action, details) VALUES (?, ?)').run([action, details]);
  }

  app.get('/api/notifications', requireAuth, (req, res) => {
    const notifications = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all([]);
    const unread = db.prepare("SELECT COUNT(*) as count FROM notifications WHERE is_read = 0").get([]).count;
    res.json({ notifications, unread });
  });

  app.post('/api/notifications/read', requireAuth, (req, res) => {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE is_read = 0").run([]);
    res.json({ success: true });
  });

  app.get('/admin/activity-log', requireAuth, (req, res) => {
    const logs = db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 100').all([]);
    res.render('activity-log', { logs, unreadCount: getUnreadCount() });
  });

  app.get('/admin/debtors', requireAuth, (req, res) => {
    const debtors = db.prepare(`
      SELECT c.*, e.name as event_name
      FROM contributors c
      JOIN events e ON e.id = c.event_id
      WHERE c.status = 'Incomplete' AND c.contribution_type = 'Promise'
      ORDER BY e.name ASC, c.remaining_balance DESC
    `).all([]);
    const grouped = {};
    debtors.forEach(function(d) {
      if (!grouped[d.event_name]) grouped[d.event_name] = [];
      grouped[d.event_name].push(d);
    });
    res.render('debtors', { grouped: grouped, unreadCount: getUnreadCount() });
  });

  app.post('/admin/events/:id/status', requireAuth, (req, res) => {
    const { status } = req.body;
    if (!['Active', 'Completed', 'Archived'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run([status, req.params.id]);
    res.json({ success: true });
    const ev = db.prepare('SELECT name FROM events WHERE id = ?').get([req.params.id]);
    logActivity('Status Change', 'Event "' + (ev ? ev.name : '') + '" set to ' + status);
  });

  app.get('/admin/dashboard', requireAuth, (req, res) => {
    try {
      const events = db.prepare('SELECT * FROM events ORDER BY created_at DESC').all([]);

      const allStats = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN contribution_type = 'Promise' THEN promise_amount ELSE 0 END), 0) as total_promised,
          COALESCE(SUM(CASE WHEN contribution_type = 'Promise' THEN paid_amount ELSE 0 END), 0) as promise_payments,
          COALESCE(SUM(CASE WHEN contribution_type = 'Cash' THEN paid_amount ELSE 0 END), 0) as total_cash,
          COUNT(*) as contributor_count
        FROM contributors
      `).get([]);

      allStats.total_collected = allStats.promise_payments + allStats.total_cash;
      allStats.total_remaining = allStats.total_promised - allStats.promise_payments;
      allStats.event_count = events.length;

      const eventStats = db.prepare(`
        SELECT event_id,
          COUNT(*) as c_count,
          COALESCE(SUM(promise_amount), 0) as c_promised,
          COALESCE(SUM(paid_amount), 0) as c_collected
        FROM contributors GROUP BY event_id
      `).all([]);

      const statsMap = {};
      eventStats.forEach(function(s) { statsMap[s.event_id] = s; });

      const chartData = events.map(function(e) {
        var s = statsMap[e.id] || { c_collected: 0, c_promised: 0, c_count: 0 };
        return { name: e.name, collected: s.c_collected, promised: s.c_promised };
      });
      var maxVal = chartData.reduce(function(m, d) { return Math.max(m, d.collected); }, 0);

      res.render('dashboard', {
        events,
        stats: allStats,
        statsMap: statsMap,
        chartData: chartData,
        maxChartVal: maxVal,
        unreadCount: getUnreadCount()
      });
    } catch (err) {
      res.status(500).send('An error occurred');
    }
  });

  app.get('/admin/events/create', requireAuth, (req, res) => {
    res.render('create-event', { error: null, form: null, unreadCount: getUnreadCount() });
  });

  app.post('/admin/events/create', requireAuth, (req, res) => {
    const { name, event_type, custom_type, groom_name, bride_name, person1_name, person2_name, event_date, venue, target_amount } = req.body;
    let type = event_type || 'Wedding';
    function formData() { return { name, event_type, custom_type, groom_name, bride_name, person1_name, person2_name, event_date, venue, target_amount }; }

    if (type === 'Other') {
      if (!custom_type || !custom_type.trim()) {
        return res.render('create-event', { error: 'Please specify the custom event type', form: formData() });
      }
      type = custom_type.trim();
    }

    if (!name) {
      return res.render('create-event', { error: 'Event name is required', form: formData() });
    }

    if (type === 'Wedding' && (!groom_name || !bride_name)) {
      return res.render('create-event', { error: 'Groom and bride names are required for wedding events', form: formData() });
    }

    if (type === 'Anniversary' && (!person1_name || !person2_name)) {
      return res.render('create-event', { error: 'Both person names are required for anniversary events', form: formData() });
    }

    if (type !== 'Wedding' && type !== 'Anniversary' && !person1_name) {
      return res.render('create-event', { error: 'Person name is required', form: formData() });
    }

    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50);
      const uniqueLink = slug + '-' + crypto.randomBytes(4).toString('hex');
      const manageToken = crypto.randomBytes(8).toString('hex');
      const result = db.prepare(
        'INSERT INTO events (name, event_type, groom_name, bride_name, person1_name, person2_name, event_date, venue, unique_link, target_amount, manage_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run([name, type, groom_name || '-', bride_name || '-', person1_name || null, person2_name || null, event_date || null, venue || null, uniqueLink, parseFloat(target_amount) || 0, manageToken]);

      res.redirect(`/admin/events/${result.lastInsertRowid}`);
      logActivity('Create Event', 'Created event: ' + name);
    } catch (err) {
      res.render('create-event', { error: 'Failed to create event', form: formData() });
    }
  });

  app.get('/manage/:token', (req, res) => {
    try {
      const event = db.prepare('SELECT * FROM events WHERE manage_token = ?').get([req.params.token]);
      if (!event) {
        return res.status(404).send('Invalid management link');
      }
      const contributors = db.prepare(
        'SELECT * FROM contributors WHERE event_id = ? ORDER BY created_at DESC'
      ).all([event.id]);
      const eventStats = db.prepare(`
        SELECT
          COALESCE(SUM(promise_amount), 0) as total_promised,
          COALESCE(SUM(paid_amount), 0) as total_paid,
          COALESCE(SUM(remaining_balance), 0) as total_remaining,
          COUNT(*) as contributor_count
        FROM contributors WHERE event_id = ?
      `).get([event.id]);
      const targetAmount = event.target_amount || 0;
      const progressPercent = targetAmount > 0 ? Math.min(100, Math.round((eventStats.total_paid / targetAmount) * 100)) : 0;
      const contributionLink = `${req.protocol}://${req.get('host')}/c/${event.unique_link}`;
      const debtors = db.prepare(
        "SELECT * FROM contributors WHERE event_id = ? AND contribution_type = 'Promise' AND status = 'Incomplete' ORDER BY remaining_balance DESC"
      ).all([event.id]);
      const notifications = db.prepare(
        'SELECT * FROM notifications WHERE event_id = ? ORDER BY created_at DESC LIMIT 20'
      ).all([event.id]);
      res.render('event-manage', { event, contributors, stats: eventStats, targetAmount, progressPercent, contributionLink, debtors, notifications });
    } catch (err) {
      res.status(500).send('An error occurred');
    }
  });

  app.get('/admin/events/:id', requireAuth, (req, res) => {
    try {
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get([req.params.id]);
      if (!event) {
        return res.status(404).send('Event not found');
      }

      const contributors = db.prepare(
        'SELECT * FROM contributors WHERE event_id = ? ORDER BY created_at DESC'
      ).all([req.params.id]);

      const eventStats = db.prepare(`
        SELECT
          COALESCE(SUM(promise_amount), 0) as total_promised,
          COALESCE(SUM(paid_amount), 0) as total_paid,
          COALESCE(SUM(remaining_balance), 0) as total_remaining,
          COUNT(*) as contributor_count
        FROM contributors WHERE event_id = ?
      `).get([req.params.id]);

      const contributionLink = `${req.protocol}://${req.get('host')}/c/${event.unique_link}`;
      const manageLink = `${req.protocol}://${req.get('host')}/manage/${event.manage_token}`;

      const targetAmount = event.target_amount || 0;
      const progressPercent = targetAmount > 0 ? Math.min(100, Math.round((eventStats.total_paid / targetAmount) * 100)) : 0;

      res.render('event-detail', { event, contributors, stats: eventStats, contributionLink, manageLink, targetAmount, progressPercent, unreadCount: getUnreadCount() });
    } catch (err) {
      res.status(500).send('An error occurred');
    }
  });

  app.get('/admin/export/:id', requireAuth, async (req, res) => {
    try {
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get([req.params.id]);
      if (!event) {
        return res.status(404).send('Event not found');
      }

      const contributors = db.prepare(
        'SELECT * FROM contributors WHERE event_id = ? ORDER BY created_at DESC'
      ).all([req.params.id]);

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Contributions');

      sheet.columns = [
        { header: 'Contributor ID', key: 'contributor_id', width: 15 },
        { header: 'Full Name', key: 'full_name', width: 25 },
        { header: 'Phone Number', key: 'phone_number', width: 20 },
        { header: 'Event Name', key: 'event_name', width: 25 },
        { header: 'Event Type', key: 'event_type', width: 18 },
        { header: 'Contribution Type', key: 'contribution_type', width: 20 },
        { header: 'Promise Amount (TZS)', key: 'promise_amount', width: 22 },
        { header: 'Paid Amount (TZS)', key: 'paid_amount', width: 20 },
        { header: 'Remaining Balance (TZS)', key: 'remaining_balance', width: 22 },
        { header: 'Payment Method', key: 'payment_method', width: 20 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Notes', key: 'notes', width: 25 },
        { header: 'Date', key: 'created_at', width: 20 }
      ];

      contributors.forEach(c => {
        sheet.addRow({
          contributor_id: c.contributor_id || '-',
          full_name: c.full_name,
          phone_number: c.phone_number || '-',
          event_name: event.name,
          event_type: event.event_type || 'Wedding',
          contribution_type: c.contribution_type,
          promise_amount: c.promise_amount || 0,
          paid_amount: c.paid_amount || 0,
          remaining_balance: c.remaining_balance || 0,
          payment_method: c.payment_method || '-',
          status: c.status,
          notes: c.notes || '',
          created_at: c.created_at
        });
      });

      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${event.name.replace(/[^a-zA-Z0-9]/g, '_')}_contributions.xlsx"`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      res.status(500).send('An error occurred');
    }
  });

  app.get('/c/:link', (req, res) => {
    try {
      const event = db.prepare('SELECT * FROM events WHERE unique_link = ?').get([req.params.link]);
      if (!event) {
        return res.status(404).send('Invalid contribution link');
      }
      res.render('contribute', { event, error: null, success: null });
    } catch (err) {
      res.status(500).send('An error occurred');
    }
  });

  app.post('/api/contribute', (req, res) => {
    const { event_id, full_name, phone_number, contribution_type, promise_amount, amount_paid, payment_method, sender_name } = req.body;

    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!contribution_type) {
      return res.status(400).json({ error: 'Contribution type is required' });
    }

    try {
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get([event_id]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

        let contributorId;
        let cidPrefix;
        if (contribution_type === 'promise') {
          if (!promise_amount || parseFloat(promise_amount) <= 0) {
            return res.status(400).json({ error: 'Please enter a valid promise amount' });
          }
          const amount = parseFloat(promise_amount);
          const result = db.prepare(`
            INSERT INTO contributors (event_id, full_name, phone_number, contribution_type, promise_amount, paid_amount, remaining_balance, status)
            VALUES (?, ?, ?, 'Promise', ?, 0, ?, 'Incomplete')
          `).run([event_id, full_name.trim(), phone_number || null, amount, amount]);
          contributorId = result.lastInsertRowid;
          cidPrefix = nextContributorId(event_id);
          db.prepare('UPDATE contributors SET contributor_id = ? WHERE id = ?').run([cidPrefix, contributorId]);
          db.prepare('INSERT INTO payments (contributor_id, amount, payment_method, sender_name) VALUES (?, 0, ?, ?)')
            .run([contributorId, '-', full_name.trim()]);
        } else if (contribution_type === 'cash') {
          if (!amount_paid || parseFloat(amount_paid) <= 0) {
            return res.status(400).json({ error: 'Please enter a valid amount' });
          }
          if (!payment_method) {
            return res.status(400).json({ error: 'Please select a payment method' });
          }
          const amount = parseFloat(amount_paid);
          const result = db.prepare(`
            INSERT INTO contributors (event_id, full_name, phone_number, contribution_type, promise_amount, paid_amount, remaining_balance, payment_method, sender_name, status)
            VALUES (?, ?, ?, 'Cash', 0, ?, 0, ?, ?, 'Done')
          `).run([event_id, full_name.trim(), phone_number || null, amount, payment_method, sender_name || full_name.trim()]);
          contributorId = result.lastInsertRowid;
          cidPrefix = nextContributorId(event_id);
          db.prepare('UPDATE contributors SET contributor_id = ? WHERE id = ?').run([cidPrefix, contributorId]);
          db.prepare('INSERT INTO payments (contributor_id, amount, payment_method, sender_name) VALUES (?, ?, ?, ?)')
            .run([contributorId, amount, payment_method, sender_name || full_name.trim()]);
        }

        res.json({ success: true, message: 'Contribution recorded successfully!', contributor_id: cidPrefix });
      addNotification(event_id, contribution_type === 'promise' ? 'new_promise' : 'new_cash',
        (contribution_type === 'promise' ? full_name.trim() + ' made a promise' : full_name.trim() + ' contributed cash') + ' for ' + event.name);
    } catch (err) {
      res.status(500).json({ error: 'An error occurred while saving your contribution' });
    }
  });

  app.post('/api/promise/list', (req, res) => {
    const { event_id } = req.body;
    try {
      const promises = db.prepare(
        "SELECT * FROM contributors WHERE event_id = ? AND contribution_type = 'Promise' ORDER BY full_name ASC"
      ).all([event_id]);
      res.json({ promises });
    } catch (err) {
      res.status(500).json({ error: 'An error occurred' });
    }
  });

  app.post('/api/promise/search', (req, res) => {
    const { event_id, full_name, contributor_id } = req.body;
    const input = (full_name || contributor_id || '').trim();

    if (!input) {
      return res.status(400).json({ error: 'Please enter your full name or contributor ID' });
    }

    try {
      let promises;
      const isId = /^CNT-\d+$/i.test(input);
      if (isId) {
        promises = db.prepare(
          'SELECT * FROM contributors WHERE event_id = ? AND contributor_id = ? AND contribution_type = "Promise" ORDER BY created_at DESC'
        ).all([event_id, input.toUpperCase()]);
      } else {
        promises = db.prepare(
          'SELECT * FROM contributors WHERE event_id = ? AND LOWER(full_name) LIKE ? AND contribution_type = "Promise" ORDER BY created_at DESC'
        ).all([event_id, '%' + input.toLowerCase() + '%']);
      }

      if (promises.length === 0) {
        return res.json({ found: false, message: 'No promise found. Please check your name/ID or make a new contribution.' });
      }

      res.json({ found: true, promises });
    } catch (err) {
      res.status(500).json({ error: 'An error occurred' });
    }
  });

  app.post('/api/contributor/autofill', (req, res) => {
    const { query } = req.body;
    if (!query || query.trim().length < 2) {
      return res.json({ matches: [] });
    }
    try {
      const q = '%' + query.trim().toLowerCase() + '%';
      const matches = db.prepare(
        "SELECT DISTINCT full_name, phone_number FROM contributors WHERE LOWER(full_name) LIKE ? OR LOWER(phone_number) LIKE ? ORDER BY full_name ASC LIMIT 10"
      ).all([q, q]);
      res.json({ matches });
    } catch (err) {
      res.json({ matches: [] });
    }
  });

  app.post('/api/promise/pay', (req, res) => {
    const { contributor_id, amount, payment_method, sender_name } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Please enter a valid payment amount' });
    }

    try {
      const contributor = db.prepare('SELECT * FROM contributors WHERE id = ?').get([contributor_id]);
      if (!contributor) {
        return res.status(404).json({ error: 'Contributor not found' });
      }

      const payAmount = parseFloat(amount);
      const newPaidAmount = contributor.paid_amount + payAmount;
      const newRemainingBalance = Math.max(0, contributor.promise_amount - newPaidAmount);
      const newStatus = newRemainingBalance <= 0 ? 'Done' : 'Incomplete';

      db.prepare('UPDATE contributors SET paid_amount = ?, remaining_balance = ?, status = ?, payment_method = ?, sender_name = ? WHERE id = ?')
        .run([newPaidAmount, newRemainingBalance, newStatus, payment_method || contributor.payment_method, sender_name || contributor.full_name, contributor_id]);

      db.prepare('INSERT INTO payments (contributor_id, amount, payment_method, sender_name) VALUES (?, ?, ?, ?)')
        .run([contributor_id, payAmount, payment_method || '-', sender_name || contributor.full_name]);

      if (newStatus === 'Done') {
        const ev = db.prepare('SELECT name FROM events WHERE id = ?').get([contributor.event_id]);
        addNotification(contributor.event_id, 'fulfilled', contributor.full_name + ' fulfilled their promise for ' + (ev ? ev.name : 'the event'));
      }

      res.json({
        success: true,
        message: 'Payment recorded successfully!',
        data: {
          paid_amount: newPaidAmount,
          remaining_balance: newRemainingBalance,
          status: newStatus
        }
      });
    } catch (err) {
      res.status(500).json({ error: 'An error occurred while processing payment' });
    }
  });

  app.get('/admin/events/:id/contributors/:cid', requireAuth, (req, res) => {
    try {
      const contributor = db.prepare('SELECT * FROM contributors WHERE id = ? AND event_id = ?').get([req.params.cid, req.params.id]);
      if (!contributor) {
        return res.status(404).send('Contributor not found');
      }
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get([req.params.id]);
      const payments = db.prepare('SELECT * FROM payments WHERE contributor_id = ? ORDER BY paid_at DESC').all([req.params.cid]);
      res.render('contributor-detail', { contributor, event, payments, unreadCount: getUnreadCount() });
    } catch (err) {
      res.status(500).send('An error occurred');
    }
  });

  app.post('/admin/events/:id/contributors/search', requireAuth, (req, res) => {
    try {
      const { query } = req.body;
      if (!query || !query.trim()) {
        const contributors = db.prepare('SELECT * FROM contributors WHERE event_id = ? ORDER BY created_at DESC').all([req.params.id]);
        return res.json({ contributors });
      }
      const q = '%' + query.trim() + '%';
      const contributors = db.prepare(
        "SELECT * FROM contributors WHERE event_id = ? AND (contributor_id LIKE ? OR full_name LIKE ? OR phone_number LIKE ?) ORDER BY created_at DESC"
      ).all([req.params.id, q, q, q]);
      res.json({ contributors });
    } catch (err) {
      res.status(500).json({ error: 'Search failed' });
    }
  });

  app.post('/admin/events/:id/contributors/manual', requireAuth, (req, res) => {
    const { full_name, phone_number, contribution_type, promise_amount, amount_paid, payment_method, sender_name } = req.body;
    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!contribution_type) {
      return res.status(400).json({ error: 'Contribution type is required' });
    }
    try {
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get([req.params.id]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      let contributorId;
      let cidPrefix;
      if (contribution_type === 'promise') {
        if (!promise_amount || parseFloat(promise_amount) <= 0) {
          return res.status(400).json({ error: 'Please enter a valid promise amount' });
        }
        const amount = parseFloat(promise_amount);
        const result = db.prepare(`
          INSERT INTO contributors (event_id, full_name, phone_number, contribution_type, promise_amount, paid_amount, remaining_balance, status)
          VALUES (?, ?, ?, 'Promise', ?, 0, ?, 'Incomplete')
        `).run([req.params.id, full_name.trim(), phone_number || null, amount, amount]);
        contributorId = result.lastInsertRowid;
        cidPrefix = nextContributorId(req.params.id);
        db.prepare('UPDATE contributors SET contributor_id = ? WHERE id = ?').run([cidPrefix, contributorId]);
        db.prepare('INSERT INTO payments (contributor_id, amount, payment_method, sender_name) VALUES (?, 0, ?, ?)')
          .run([contributorId, '-', full_name.trim()]);
      } else {
        if (!amount_paid || parseFloat(amount_paid) <= 0) {
          return res.status(400).json({ error: 'Please enter a valid amount' });
        }
        const amount = parseFloat(amount_paid);
        const result = db.prepare(`
          INSERT INTO contributors (event_id, full_name, phone_number, contribution_type, promise_amount, paid_amount, remaining_balance, payment_method, sender_name, status)
          VALUES (?, ?, ?, 'Cash', 0, ?, 0, ?, ?, 'Done')
        `).run([req.params.id, full_name.trim(), phone_number || null, amount, payment_method || null, sender_name || full_name.trim()]);
        contributorId = result.lastInsertRowid;
        cidPrefix = nextContributorId(req.params.id);
        db.prepare('UPDATE contributors SET contributor_id = ? WHERE id = ?').run([cidPrefix, contributorId]);
        db.prepare('INSERT INTO payments (contributor_id, amount, payment_method, sender_name) VALUES (?, ?, ?, ?)')
          .run([contributorId, amount, payment_method || '-', sender_name || full_name.trim()]);
      }
      res.json({ success: true, message: 'Contribution added successfully' });
      logActivity('Manual Entry', 'Added ' + (contribution_type === 'promise' ? 'promise' : 'cash contribution') + ' for ' + full_name.trim() + ' in event #' + req.params.id);
    } catch (err) {
      res.status(500).json({ error: 'Failed to add contribution' });
    }
  });

  app.post('/admin/events/:id/contributors/:cid/notes', requireAuth, (req, res) => {
    try {
      const { notes } = req.body;
      db.prepare('UPDATE contributors SET notes = ? WHERE id = ? AND event_id = ?').run([notes || '', req.params.cid, req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save notes' });
    }
  });

  app.post('/admin/events/:id/edit', requireAuth, (req, res) => {
    try {
      const { name, event_type, custom_type, groom_name, bride_name, person1_name, person2_name, event_date, venue, target_amount } = req.body;
      const finalType = event_type === 'Other' && custom_type ? custom_type : event_type;
      db.prepare(`UPDATE events SET name=?, event_type=?, groom_name=?, bride_name=?, person1_name=?, person2_name=?, event_date=?, venue=?, target_amount=? WHERE id=?`)
        .run([name, finalType, groom_name||null, bride_name||null, person1_name||null, person2_name||null, event_date||null, venue||null, target_amount||0, req.params.id]);
      res.json({ success: true });
      logActivity('Edit Event', 'Edited event: ' + name);
    } catch (err) {
      res.status(500).json({ error: 'Failed to edit event' });
    }
  });

  app.post('/admin/events/:id/contributors/:cid/edit', requireAuth, (req, res) => {
    try {
      const { full_name, phone_number } = req.body;
      db.prepare('UPDATE contributors SET full_name=?, phone_number=? WHERE id=? AND event_id=?')
        .run([full_name, phone_number||null, req.params.cid, req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update contributor' });
    }
  });

  app.post('/admin/events/:id/delete', requireAuth, (req, res) => {
    try {
      const event = db.prepare('SELECT * FROM events WHERE id = ?').get([req.params.id]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      const contributors = db.prepare('SELECT id FROM contributors WHERE event_id = ?').all([req.params.id]);
      const ids = contributors.map(function(c) { return c.id; });
      if (ids.length > 0) {
        db.prepare('DELETE FROM payments WHERE contributor_id IN (' + ids.map(function() { return '?' }).join(',') + ')').run(ids);
      }
      db.prepare('DELETE FROM contributors WHERE event_id = ?').run([req.params.id]);
      db.prepare('DELETE FROM events WHERE id = ?').run([req.params.id]);
      res.json({ success: true });
      logActivity('Delete Event', 'Deleted event: ' + event.name);
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete event' });
    }
  });

  app.get('/', (req, res) => {
    res.redirect('/admin/login');
  });

  app.use((req, res) => {
    res.status(404).send('Page not found');
  });

  app.listen(PORT, () => {
    console.log(`D MARK EVENT MANAGEMENT running at http://localhost:${PORT}`);
    console.log(`Admin Login: http://localhost:${PORT}/admin/login`);
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
