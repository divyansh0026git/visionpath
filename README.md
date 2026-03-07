Vision Path: Eyes-Free Indoor Navigation
Vision Path is a revolutionary, infrastructure-independent indoor navigation system designed for zero-visibility environments. Developed by team VitalCoders from the Heritage Institute of Technology, Kolkata, this project leverages smartphone sensor fusion and spatial audio to guide users safely when GPS, maps, and visual cues fail.
+4

🚀 The Core Innovation
Unlike traditional navigation that relies on cameras or pre-installed beacons, Vision Path uses Pedestrian Dead Reckoning (PDR). It tracks your movement in real-time using only your phone's internal sensors, creating a "breadcrumb" path that allows for safe backtracking and egress during emergencies.
+2

Why it’s Different:

Infrastructure-Free: No Wi-Fi, GPS, or Bluetooth beacons required.
+1

Eyes-Free & Hands-Free: Uses 3D spatial audio cues to guide the user naturally.
+1

Emergency-First: Prioritizes survival and exit (egress) over simple point-to-point accuracy.

Battery Efficient: Avoids continuous camera or network usage, preventing the rapid battery drain common in AR/GPS apps.
+1

🛠 Tech Stack
Component	Technologies Used
Frontend	
Progressive Web App (PWA), HTML5, CSS3, JavaScript 

Navigation Engine	
Sensor Fusion, PDR, Step Detection & Heading Estimation 

Sensors	
Web Sensors API (Accelerometer, Gyroscope, Magnetometer) 

Audio	
Web Audio API (3D Spatial Panning, Dynamic Pitch/Frequency) 

AI/Vision	
TensorFlow Lite / ONNX Runtime for On-device Depth Estimation 

📱 How It Works
Set Anchor: The user sets an entry point or destination using the PWA.

Sensor Tracking: The app detects steps and direction changes via the Accelerometer and Gyroscope.

Path Memory: "Breadcrumb" vectors are stored in-memory or via IndexedDB to track the route.

Aural Guidance: The user hears 3D audio; left/right panning indicates direction, while pitch and frequency indicate distance.
+1

Panic Mode: In an emergency, the system overrides the state to reverse the breadcrumb path, guiding the user back to the safe exit.

🌍 Target Audience & Impact
Visually Impaired: Empowering 2.2B people globally to navigate complex indoor spaces independently.

Emergency Responders: Helping firefighters and police navigate smoke-filled, zero-visibility buildings.

Industrial Workers: Assisting warehouse staff in locating inventory and exits in low-light environments.

🔮 Future Scope
Thermal Imaging: Integration to detect victims or destinations through dense smoke.

Haptic Feedback: Support for haptic belts or smartwatches for silent navigation.

AI Drift Correction: Machine learning models to further refine sensor accuracy over long durations.

👥 The Team: VitalCoders
Rajveer Singh: AI & Vision Specialist 

Archisha Majumdar: Backend, Sensors & Spatial Audio 

Rishav Kumar: Frontend & Experiment 

Divyansh saraf: Research & Team Management
