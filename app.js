// ==========================================
// 1. อัปเดตตรรกะตัวโน้ต (ขยายช่วงความถี่ถึง B5)
// ==========================================
const NOTE_FREQUENCIES = {
    "C4": 261.63, "C#4": 277.18, "D4": 293.66, "D#4": 311.13, "E4": 329.63, "F4": 349.23, "F#4": 369.99, "G4": 392.00, "G#4": 415.30, "A4": 440.00, "A#4": 466.16, "B4": 493.88,
    "C5": 523.25, "C#5": 554.37, "D5": 587.33, "D#5": 622.25, "E5": 659.25, "F5": 698.46, "F#5": 739.99, "G5": 783.99, "G#5": 830.61, "A5": 880.00, "A#5": 932.33, "B5": 987.77
};

// ตัวแปรระบบเสียงหลัก
let audioCtx = null;
let masterGain = null;
let analyser = null; 
let delayNode = null; 

// ออบเจกต์สำหรับจำสถานะคีย์ที่กำลังกดเล่นอยู่ (เพื่อไม่ให้เกิดเสียงซ้อนซึ่่งกันและกัน)
const activeOscillators = {};

// ดึง Elements จากหน้าเว็บ HTML
const waveformSelect = document.getElementById('waveform');
const volumeInput = document.getElementById('volume');
const delayToggle = document.getElementById('delay-toggle');
const keys = document.querySelectorAll('.key');
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');

// ==========================================
// 2. ฟังก์ชันเริ่มต้นระบบเสียง (Web Audio API Initialization)
// ==========================================
function initAudio() {
    if (!audioCtx) {
        // สร้างระบบเสียงหลักของเบราว์เซอร์
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // สร้างตัวควบคุมความดังภาพรวม (Master Gain)
        masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(volumeInput.value, audioCtx.currentTime);

        // สร้างระบบเอฟเฟกต์เสียงสะท้อน (Delay & Feedback Loop)
        delayNode = audioCtx.createDelay();
        delayNode.delayTime.setValueAtTime(0.3, audioCtx.currentTime); // ความหน่วง 0.3 วินาที
        
        const feedback = audioCtx.createGain();
        feedback.gain.setValueAtTime(0.4, audioCtx.currentTime); // ให้หางเสียงสะท้อนเบาลงทีละ 40%

        // เชื่อมสายสัญญานกล่องเอฟเฟกต์สะท้อนเข้าหากัน
        delayNode.connect(feedback);
        feedback.connect(delayNode);

        // สร้างตัววิเคราะห์ข้อมูลเสียง (Analyser Node)
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64; // ค่าความละเอียดในการแสดงผลแท่งกราฟ (ยิ่งน้อย แท่งยิ่งกว้าง)

        // เชื่อมวงจรสายหลักทั้งหมด: MasterGain -> Analyser -> ลำโพงปลายทาง
        masterGain.connect(analyser);
        analyser.connect(audioCtx.destination);

        // สั่งให้เริ่มวาดกราฟ Visualizer แบบ Real-time
        drawVisualizer();
    }
}

// อัปเดตความดังตามสไลเดอร์แบบวินาทีต่อวินาที
volumeInput.addEventListener('input', () => {
    if (masterGain) {
        masterGain.gain.setValueAtTime(volumeInput.value, audioCtx.currentTime);
    }
});

// ==========================================
// 3. ฟังก์ชันสร้างโมดูลเสียงรบกวน (Noise Buffer Generators)
// ==========================================
function createNoiseBuffer(type) {
    const bufferSize = audioCtx.sampleRate * 2; // สร้างก้อนเสียงยาวสูงสุดค้างไว้ 2 วินาที
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    
    let b0, b1, b2, b3, b4, b5, b6;
    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0;

    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        if (type === 'white-noise') {
            data[i] = white;
        } else if (type === 'pink-noise') {
            // อัลกอริทึมคัดกรองสัญญาณความถี่เพื่อแปลงเป็น Pink Noise
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
            data[i] *= 0.11; // ชดเชยปริมาณความดังให้อยู่ในเกณฑ์ปลอดภัย
            b6 = white * 0.115926;
        }
    }
    return buffer;
}

// ==========================================
// 4. ฟังก์ชันเปิด/ปิด เสียงตัวโน้ต (Play / Stop Core Logic)
// ==========================================
function startNote(note, keyElement) {
    initAudio();
    if (activeOscillators[note]) return; // ถ้าตัวโน้ตกำลังดังอยู่แล้ว ไม่ต้องส่งเสียงซ้ำ

    keyElement.classList.add('active'); // เพิ่ม Class ให้ CSS แสดงแสงนีออนวาบขึ้นมา
    
    const currentWaveform = waveformSelect.value;
    const noteGain = audioCtx.createGain();
    
    // ตั้งค่า Envelope ป้องกันเสียงเปรี๊ยะตอนเริ่มกด (Attack Phase)
    noteGain.gain.setValueAtTime(0, audioCtx.currentTime);
    noteGain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.02);

    const soundSources = [];

    // --- CASE 1: เสียงกลุ่ม NOISE (White / Pink Noise) ---
    if (currentWaveform === 'white-noise' || currentWaveform === 'pink-noise') {
        const noiseNode = audioCtx.createBufferSource();
        noiseNode.buffer = createNoiseBuffer(currentWaveform);
        noiseNode.loop = true;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(NOTE_FREQUENCIES[note] * 2, audioCtx.currentTime);

        noiseNode.connect(filter);
        filter.connect(noteGain);
        noiseNode.start();
        soundSources.push(noiseNode);
    } 
    // --- CASE 2: เสียงกลุ่ม SUPER-SAW (EDM คีย์เหลื่อม) ---
    else if (currentWaveform === 'super-saw') {
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();

        osc1.type = 'sawtooth';
        osc2.type = 'sawtooth';

        osc1.frequency.setValueAtTime(NOTE_FREQUENCIES[note], audioCtx.currentTime);
        osc2.frequency.setValueAtTime(NOTE_FREQUENCIES[note], audioCtx.currentTime);
        osc2.detune.setValueAtTime(12, audioCtx.currentTime); // ปรับคีย์เบี่ยงเบนเล็กน้อยสร้างมิติ

        osc1.connect(noteGain);
        osc2.connect(noteGain);
        osc1.start();
        osc2.start();
        soundSources.push(osc1, osc2);
    }
    // --- CASE 3: เสียงกลุ่ม FAT SQUARE (เบสไซไฟทุ้มต่ำ) ---
    else if (currentWaveform === 'fat-square') {
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();

        osc1.type = 'square';
        osc2.type = 'square';

        osc1.frequency.setValueAtTime(NOTE_FREQUENCIES[note], audioCtx.currentTime);
        osc2.frequency.setValueAtTime(NOTE_FREQUENCIES[note] / 2, audioCtx.currentTime); // ลดระดับคีย์ลงมา 1 Octave
        osc2.detune.setValueAtTime(-10, audioCtx.currentTime);

        osc1.connect(noteGain);
        osc2.connect(noteGain);
        osc1.start();
        osc2.start();
        soundSources.push(osc1, osc2);
    }
    // --- CASE 4: เสียงกลุ่ม SPACE CHIME (เสียงระฆังแก้วอวกาศ) ---
    else if (currentWaveform === 'chime') {
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();

        osc1.type = 'triangle';
        osc2.type = 'sine';

        osc1.frequency.setValueAtTime(NOTE_FREQUENCIES[note], audioCtx.currentTime);
        osc2.frequency.setValueAtTime(NOTE_FREQUENCIES[note] * 4, audioCtx.currentTime); // ทวีคูณความถี่ให้เกิดเสียงแหลมสูงใสๆ

        osc1.connect(noteGain);
        osc2.connect(noteGain);
        osc1.start();
        osc2.start();
        soundSources.push(osc1, osc2);
    }
    // --- CASE 5: เสียงเดี่ยวมาตรฐานดั้งเดิม ---
    else {
        const osc = audioCtx.createOscillator();
        osc.type = currentWaveform;
        osc.frequency.setValueAtTime(NOTE_FREQUENCIES[note], audioCtx.currentTime);
        
        osc.connect(noteGain);
        osc.start();
        soundSources.push(osc);
    }

    // ประมวลผลต่อเข้ากล่องสวิตช์เปิด/ปิด เอฟเฟกต์สะท้อน (Echo / Delay Toggle)
    if (delayToggle.checked) {
        noteGain.connect(masterGain);
        noteGain.connect(delayNode);
        delayNode.connect(masterGain);
    } else {
        noteGain.connect(masterGain);
    }

    // จัดเก็บหน่วยความจำอ้างอิงเพื่อใช้ส่งค่าปิดคีย์ทั้งหมดในภายหลัง
    activeOscillators[note] = { sources: soundSources, noteGain };
}

function stopNote(note, keyElement) {
    if (activeOscillators[note]) {
        keyElement.classList.remove('active'); // เอาแสงไฟเรืองแสงออกจากหน้าคีย์ HTML
        const { sources, noteGain } = activeOscillators[note];
        
        // ไล่ระดับเสียงลงให้นุ่มนวลก่อนปิดสนิท (Release Phase) ป้องกันเสียงขาดเหลี่ยมคม
        noteGain.gain.setValueAtTime(noteGain.gain.value, audioCtx.currentTime);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15); 
        
        // วนลูปเพื่อสั่งสั่งหยุดการผลิตเสียงใน Thread ทั้งหมดของโน้ตนั้น ๆ
        sources.forEach(source => {
            source.stop(audioCtx.currentTime + 0.15);
        });
        
        delete activeOscillators[note]; // ลบออกจากออบเจกต์เพื่อเปิดรับการกดครั้งต่อไป
    }
}

// ==========================================
// 5. ระบบคำนวณและวาดกราฟ Visualizer นีออนคู่อัตโนมัติ
// ==========================================
function drawVisualizer() {
    requestAnimationFrame(drawVisualizer); // สั่งรีเฟรชภาพกราฟิกให้ตรงตาม Refresh Rate หน้าจอ

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray); // อ่านคลื่นความถี่ใส่ลงในโครงสร้างแบบ Array

    // ล้างและระบายพื้นหลัง Canvas ใหม่ทุกๆ เฟรม
    canvasCtx.fillStyle = '#07070d';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 1.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;

        // แยกจับสีสไตล์คู่ตรงข้าม Cyberpunk นีออน (ชมพู-สลับ-ฟ้าเหลื่อมสลับตัวกันไป)
        if (i % 2 === 0) {
            canvasCtx.fillStyle = `rgb(255, 0, 119)`; // นีออนชมพู (Neon Pink)
        } else {
            canvasCtx.fillStyle = `rgb(0, 255, 204)`; // นีออนฟ้า (Neon Cyan)
        }

        // วาดรูปแท่งสี่เหลี่ยมตามความสูงของพลังงานเสียงที่วิเคราะห์ได้
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
        x += barWidth;
    }
}

// ==========================================
// 6. ดักจับเหตุการณ์ (Event Listeners สำหรับการควบคุม)
// ==========================================

// สำหรับคลิกเมาส์และลากสัมผัสหน้าจอ
keys.forEach(key => {
    const note = key.getAttribute('data-note');
    key.addEventListener('mousedown', (e) => { e.preventDefault(); startNote(note, key); });
    window.addEventListener('mouseup', () => stopNote(note, key));
    key.addEventListener('touchstart', (e) => { e.preventDefault(); startNote(note, key); });
    key.addEventListener('touchend', (e) => { e.preventDefault(); stopNote(note, key); });
});

// สำหรับระบบปุ่มกดบนคีย์บอร์ดคอมพิวเตอร์ Desktop
window.addEventListener('keydown', (e) => {
    if (e.repeat) return; // ล็อคระบบไม่ให้คอมฯ ยิงคีย์รัวๆ เวลาแช่นิ้วค้าง
    const pressedKey = e.key.toUpperCase();
    const keyElement = document.querySelector(`.key[data-key="${pressedKey}"]`);
    if (keyElement) {
        startNote(keyElement.getAttribute('data-note'), keyElement);
    }
});

window.addEventListener('keyup', (e) => {
    const pressedKey = e.key.toUpperCase();
    const keyElement = document.querySelector(`.key[data-key="${pressedKey}"]`);
    if (keyElement) {
        stopNote(keyElement.getAttribute('data-note'), keyElement);
    }
});

// ==========================================
// 7. คลังเพลงอัตโนมัติ (Iconic Hook & Riff Edition)
// ==========================================
const SONGS = {
    // 1. Linkin Park - In The End (ท่อนเปียโนท่อนฮิตที่ทุกคนต้องฮัมตาม)
    hbd: [
        { note: "A4", duration: 300, delay: 100 },
        { note: "C5", duration: 300, delay: 100 },
        { note: "C5", duration: 150, delay: 50 },
        { note: "C5", duration: 150, delay: 50 },
        { note: "C5", duration: 150, delay: 50 },
        { note: "B4", duration: 200, delay: 100 },
        { note: "A4", duration: 400, delay: 300 }, // ลูปแรก
        
        { note: "A4", duration: 300, delay: 100 },
        { note: "C5", duration: 300, delay: 100 },
        { note: "C5", duration: 150, delay: 50 },
        { note: "C5", duration: 150, delay: 50 },
        { note: "C5", duration: 150, delay: 50 },
        { note: "B4", duration: 200, delay: 100 },
        { note: "A4", duration: 400, delay: 300 }  // ลูปสอง
    ],

    // 2. Linkin Park - Numb (ท่อนคีย์บอร์ด Hook เปิดเพลงอันทรงพลัง)
    mo_lam: [
        { note: "A4", duration: 500, delay: 100 },
        { note: "F4", duration: 500, delay: 100 },
        { note: "C5", duration: 500, delay: 100 },
        { note: "G4", duration: 500, delay: 100 }, // รอบแรก
        
        { note: "A4", duration: 500, delay: 100 },
        { note: "F4", duration: 500, delay: 100 },
        { note: "C5", duration: 500, delay: 100 },
        { note: "G4", duration: 800, delay: 300 }  // รอบสองลากยาว
    ],

    // 3. Still D.R.E. (คอร์ดเปียโนดีดรัวสไตล์ West Coast แท้ๆ จังหวะขัดนิดๆ ลื่นไหล)
    mario: [
        // บล็อกที่ 1 (8 ครั้ง)
        { note: "C5", duration: 100, delay: 120 }, { note: "C5", duration: 100, delay: 120 }, { note: "C5", duration: 100, delay: 120 }, { note: "C5", duration: 100, delay: 120 },
        { note: "C5", duration: 100, delay: 120 }, { note: "C5", duration: 100, delay: 120 }, { note: "C5", duration: 100, delay: 120 }, { note: "C5", duration: 100, delay: 120 },
        // บล็อกที่ 2 (3 ครั้ง ตกลงมานิดนึง)
        { note: "B4", duration: 100, delay: 120 }, { note: "B4", duration: 100, delay: 120 }, { note: "B4", duration: 100, delay: 120 },
        // บล็อกที่ 3 (5 ครั้ง ตบท้ายลูป)
        { note: "A4", duration: 100, delay: 120 }, { note: "A4", duration: 100, delay: 120 }, { note: "A4", duration: 100, delay: 120 }, { note: "A4", duration: 100, delay: 120 }, { note: "A4", duration: 100, delay: 200 }
    ],

    // 4. The Next Episode (ท่อนไลน์เบสและกีตาร์ดีดตื้ดๆ "ตึด ตึด ตึด ตึด ตึ๊ด..")
    bat: [
        { note: "G4", duration: 150, delay: 80 },
        { note: "G4", duration: 150, delay: 80 },
        { note: "A#4", duration: 200, delay: 150 },
        { note: "A4", duration: 150, delay: 80 },
        { note: "F4", duration: 150, delay: 80 },
        { note: "G4", duration: 400, delay: 300 }, // จบห้องที่ 1
        
        { note: "G4", duration: 150, delay: 80 },
        { note: "G4", duration: 150, delay: 80 },
        { note: "A#4", duration: 200, delay: 150 },
        { note: "A4", duration: 150, delay: 80 },
        { note: "F4", duration: 150, delay: 80 },
        { note: "G4", duration: 400, delay: 300 }  // จบห้องที่ 2
    ],

    // 5. Somebody That I Used To Know (ท่อนระนาดที่ Gotye ร้องแก้คำว่า "But you didn't have to cut me off..")
    loy_krathong: [
        { note: "G4", duration: 150, delay: 100 },
        { note: "G4", duration: 150, delay: 100 },
        { note: "F4", duration: 150, delay: 100 },
        { note: "F4", duration: 150, delay: 100 },
        { note: "D#4", duration: 200, delay: 150 },
        { note: "F4", duration: 200, delay: 150 },
        { note: "G4", duration: 400, delay: 250 }, // วลีที่ 1
        
        { note: "G4", duration: 150, delay: 100 },
        { note: "G4", duration: 150, delay: 100 },
        { note: "F4", duration: 150, delay: 100 },
        { note: "F4", duration: 150, delay: 100 },
        { note: "D#4", duration: 200, delay: 150 },
        { note: "A#4", duration: 400, delay: 300 }  // วลีที่ 2 (เสียงโดดขึ้นสูง)
    ]
};

let currentSongTimeout = null; // ตัวแปรเก็บคิวคอยตัดจบเพลง

// ฟังก์ชันหลักที่ใช้สั่งเล่นเพลง
function playSong(songKey) {
    // 1. ถ้ามีเพลงอื่นเล่นอยู่ ให้สั่งหยุดก่อน
    stopSong();
    initAudio();

    const song = SONGS[songKey];
    const stopButton = document.getElementById('btn-stop-music');
    stopButton.style.display = 'inline-block'; // แสดงปุ่ม STOP เมื่อมีเพลงเล่น

    let currentNoteIndex = 0;

    // ฟังก์ชันย่อยทำหน้าที่วนลูปทีละโน้ตตามไทม์ไลน์
    function playNextNote() {
        if (currentNoteIndex >= song.length) {
            // เมื่อเล่นจบเพลง ให้ซ่อนปุ่ม STOP
            stopButton.style.display = 'none';
            return;
        }

        const currentStep = song[currentNoteIndex];
        const keyElement = document.querySelector(`.key[data-note="${currentStep.note}"]`);

        if (keyElement) {
            // สั่งเล่นเสียงผ่านระบบเดิมที่เรามี
            startNote(currentStep.note, keyElement);

            // เมื่อครบกำหนดเวลา (duration) ให้สั่งหยุดเสียงโน้ตตัวนี้
            setTimeout(() => {
                stopNote(currentStep.note, keyElement);
            }, currentStep.duration);
        }

        // ตั้งเวลาเพื่อเตรียมเล่นโน้ตตัวถัดไป (นับจากเวลาค้างเสียง + เวลาเว้นวรรค)
        currentNoteIndex++;
        currentSongTimeout = setTimeout(playNextNote, currentStep.duration + currentStep.delay);
    }

    // เริ่มคิวโน้ตตัวแรก
    playNextNote();
}

// ฟังก์ชันสั่งหยุดเพลงกะทันหัน และล้างเสียงที่ค้างอยู่ทั้งหมด
function stopSong() {
    if (currentSongTimeout) {
        clearTimeout(currentSongTimeout);
        currentSongTimeout = null;
    }

    // ไล่ปิดเสียงโน้ตทุกคีย์ที่อาจจะค้างอยู่ ณ ตอนนั้น
    keys.forEach(key => {
        const note = key.getAttribute('data-note');
        stopNote(note, key);
    });

    document.getElementById('btn-stop-music').style.display = 'none';
}