/**
 * Created by dafeng on 16-1-26.
 */

(function () {
  var mediaElement;
  var timerFlag = true;


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
    timer = document.getElementById('timer');

    document.getElementById('btn').addEventListener('click', function (event) {
      var ipport = document.getElementById('ipaddr').value;
      mediaElement.src = "rtsp://" + ipport + "/live";
      var result = ipport.split(":");
      document.getElementById("output_ip").innerHTML = result[0];
      document.getElementById("output_port").innerHTML = result[1];
      if (timerFlag) {
        startTimer();
        timerFlag = false;
      }
    });

    mediaElement.addEventListener('error', function (event) {
    });
    mediaElement.addEventListener('stalled', function (event) {
    });
    mediaElement.addEventListener('waiting', function (event) {
    });
    mediaElement.addEventListener('playing', function (event) {
    });
    mediaElement.addEventListener('pause', function (event) {
    });
    mediaElement.addEventListener('ended', function (event) {
    });
    mediaElement.addEventListener('seeking', function (event) {
    });
    mediaElement.addEventListener('seeked', function (event) {
    });
    mediaElement.addEventListener('volumechange', function (event) {
    });
    mediaElement.addEventListener('loadedmetadata', function (event) {
    });

  }
})();
