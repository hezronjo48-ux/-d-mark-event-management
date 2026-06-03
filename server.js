const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.redirect('/admin/login');
}

const dbInit = require('./database');

async function main() {
  const db = await dbInit.init();

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

  app.get('/admin/dashboard', requireAuth, (req, res) => {
    try {
      const events = db.prepare('SELECT * FROM events ORDER BY created_at DESC').all([]);

      const stats = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN contribution_type = 'Promise' THEN promise_amount ELSE 0 END), 0) as total_promised,
          COALESCE(SUM(CASE WHEN contribution_type = 'Promise' THEN paid_amount ELSE 0 END), 0) as promise_payments,
          COALESCE(SUM(CASE WHEN contribution_type = 'Cash' THEN paid_amount ELSE 0 END), 0) as total_cash,
          COUNT(*) as contributor_count
        FROM contributors
      `).get([]);

      stats.total_collected = stats.promise_payments + stats.total_cash;
      stats.total_remaining = stats.total_promised - stats.promise_payments;
      stats.event_count = events.length;

      res.render('dashboard', {
        events,
        stats
      });
    } catch (err) {
      res.status(500).send('An error occurred');
    }
  });

  app.get('/admin/events/create', requireAuth, (req, res) => {
    res.render('create-event', { error: null, form: null });
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
      const uniqueLink = crypto.randomBytes(6).toString('hex');
      const result = db.prepare(
        'INSERT INTO events (name, event_type, groom_name, bride_name, person1_name, person2_name, event_date, venue, unique_link, target_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run([name, type, groom_name || '-', bride_name || '-', person1_name || null, person2_name || null, event_date || null, venue || null, uniqueLink, parseFloat(target_amount) || 0]);

      res.redirect(`/admin/events/${result.lastInsertRowid}`);
    } catch (err) {
      res.render('create-event', { error: 'Failed to create event', form: formData() });
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

      const targetAmount = event.target_amount || 0;
      const progressPercent = targetAmount > 0 ? Math.min(100, Math.round((eventStats.total_paid / targetAmount) * 100)) : 0;

      res.render('event-detail', { event, contributors, stats: eventStats, contributionLink, targetAmount, progressPercent });
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
        db.prepare('UPDATE contributors SET contributor_id = ? WHERE id = ?').run(['CNT-' + String(contributorId).padStart(3, '0'), contributorId]);
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
        db.prepare('UPDATE contributors SET contributor_id = ? WHERE id = ?').run(['CNT-' + String(contributorId).padStart(3, '0'), contributorId]);
        db.prepare('INSERT INTO payments (contributor_id, amount, payment_method, sender_name) VALUES (?, ?, ?, ?)')
          .run([contributorId, amount, payment_method, sender_name || full_name.trim()]);
      }

      res.json({ success: true, message: 'Contribution recorded successfully!', contributor_id: 'CNT-' + String(contributorId).padStart(3, '0') });
    } catch (err) {
      res.status(500).json({ error: 'An error occurred while saving your contribution' });
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
      res.render('contributor-detail', { contributor, event, payments });
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
        db.prepare('UPDATE contributors SET contributor_id = ? WHERE id = ?').run(['CNT-' + String(contributorId).padStart(3, '0'), contributorId]);
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
        db.prepare('UPDATE contributors SET contributor_id = ? WHERE id = ?').run(['CNT-' + String(contributorId).padStart(3, '0'), contributorId]);
        db.prepare('INSERT INTO payments (contributor_id, amount, payment_method, sender_name) VALUES (?, ?, ?, ?)')
          .run([contributorId, amount, payment_method || '-', sender_name || full_name.trim()]);
      }
      res.json({ success: true, message: 'Contribution added successfully' });
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
