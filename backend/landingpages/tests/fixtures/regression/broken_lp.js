function trackSignup(name) {
  console.log('signup: ' + name)
}

const userInput = document.getElementById('email').value;
eval(userInput);

document.getElementById('welcome-banner').innerHTML = '<b>' + userInput + '</b>';

const submitButton = document.querySelector('#submit-button-that-does-not-exist');
submitButton.addEventListener('click', function () {
  trackSignup(userInput);
});

function validateForm(value) {
  return value.length > 0;
}
