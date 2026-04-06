(function () {
  'use strict';

  var digits = document.querySelectorAll('.code-digit');
  var errorEl = document.getElementById('auth-error');
  var form = document.getElementById('auth-form');

  // Auto-focus first digit on load
  if (digits.length > 0) {
    digits[0].focus();
  }

  // Prevent form default submit
  form.addEventListener('submit', function (e) {
    e.preventDefault();
  });

  digits.forEach(function (input, idx) {
    input.addEventListener('input', function () {
      // Replace non-digits
      input.value = input.value.replace(/\D/g, '');

      if (input.value && idx < digits.length - 1) {
        digits[idx + 1].focus();
      }

      // Auto-submit when 6th digit filled
      if (idx === digits.length - 1 && input.value) {
        submit();
      }
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !input.value && idx > 0) {
        digits[idx - 1].value = '';
        digits[idx - 1].focus();
      }
    });

    input.addEventListener('paste', function (e) {
      e.preventDefault();
      var pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      for (var i = 0; i < digits.length; i++) {
        digits[i].value = pasted[i] || '';
      }
      if (pasted.length >= digits.length) {
        submit();
      } else if (pasted.length > 0) {
        digits[Math.min(pasted.length, digits.length - 1)].focus();
      }
    });
  });

  function submit() {
    var code = '';
    digits.forEach(function (d) { code += d.value; });

    if (code.length !== 6) return;

    // Disable inputs during request
    digits.forEach(function (d) { d.disabled = true; });
    errorEl.hidden = true;

    fetch('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ code: code }),
    })
      .then(function (res) {
        if (res.ok) {
          document.getElementById('auth-screen').classList.remove('active');
          document.getElementById('app-screen').classList.add('active');
          window.dispatchEvent(new CustomEvent('hotline-authed'));
        } else {
          return res.json().then(function (data) {
            throw new Error(data.error || 'Invalid code');
          });
        }
      })
      .catch(function (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
        digits.forEach(function (d) {
          d.disabled = false;
          d.value = '';
        });
        digits[0].focus();
      });
  }
})();
