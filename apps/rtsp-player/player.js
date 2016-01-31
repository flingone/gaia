/**
 * Created by dafeng on 16-1-26.
 */

(function () {
  var mediaElement;
  var label;


  function formatTime(digit) {
    if (digit >=0 && digit < 10) {
      return "0" + digit.toString();
    }
    return digit.toString();
  }

  function startTimer() {
    var timeNow = timer.innerHTML;
    var timerArray = timeNow.split(":");
    var seconds = parseInt(timerArray[2]);
    var minutes = parseInt(timerArray[1]);
    var hours = parseInt(timerArray[0]);
    seconds += 1;
    // seconds
    if (seconds >= 60) {
      seconds = 0;
      minutes += 1;
    }
    // minutes
    if (minutes >= 60) {
      minutes = 0;
      hours += 1;
    }
    timerArray[0] = formatTime(hours);
    timerArray[1] = formatTime(minutes);
    timerArray[2] = formatTime(seconds);

    timer.innerHTML = timerArray[0] + ":" + timerArray[1] + ":" + timerArray[2];
    var t = setTimeout(startTimer, 1000);
  }

  window.onload = function () {
    console.log("XXXXX window onload");
    mediaElement = document.getElementById('media');
    label = document.getElementById('label');
    timer = document.getElementById('timer');

    document.getElementById('btn').addEventListener('click', function (event) {
      var ipport = document.getElementById('ipaddr').value;
      mediaElement.src = "rtsp://" + ipport + "/live";
      var result = ipport.split(":");
      document.getElementById("output_ip").innerHTML = result[0];
      document.getElementById("output_port").innerHTML = result[1];
      startTimer();
    });

    mediaElement.addEventListener('error', function (event) {
      label.innerHTML = "error";
    });
    mediaElement.addEventListener('stalled', function (event) {
      label.innerHTML = "stalled";
    });
    mediaElement.addEventListener('waiting', function (event) {
      label.innerHTML = "waiting";
    });
    mediaElement.addEventListener('playing', function (event) {
      label.innerHTML = "playing";
    });
    mediaElement.addEventListener('pause', function (event) {
      label.innerHTML = "pause";
    });
    mediaElement.addEventListener('ended', function (event) {
      label.innerHTML = "ended";
    });
    mediaElement.addEventListener('seeking', function (event) {
      label.innerHTML = "seeking";
    });
    mediaElement.addEventListener('seeked', function (event) {
      label.innerHTML = "seeked";
    });
    mediaElement.addEventListener('volumechange', function (event) {
      label.innerHTML = "volumechange";
    });
    mediaElement.addEventListener('loadedmetadata', function (event) {
      label.innerHTML = "loadedmetadata";
    });

  }
})();
