
# Portrait OboStudio 📸

> **Beyond the lens of reality.**  
> Create professional, cinematic, and surreal portraits of yourself or your friends using the power of Google's Gemini 3 Pro.

![Portrait OboStudio](https://img.shields.io/badge/Status-Live-0ea5e9?style=for-the-badge)
![Gemini 3 Pro](https://img.shields.io/badge/AI-Gemini_3_Pro-purple?style=for-the-badge)
![Client Side](https://img.shields.io/badge/Architecture-Client_Side-green?style=for-the-badge)

**🔗 Live App:** [https://portrait.obokaman.com/](https://portrait.obokaman.com/)

---

## 🤔 What is this?

**Portrait OboStudio** is a "virtual photography studio". Unlike standard image generators where you just type a prompt, OboStudio creates a structured workflow to maintain character consistency:

1.  **It "Looks" first:** You upload reference photos, and the AI (Gemini 2.5 Flash) analyzes the physical traits of the subjects.
2.  **It "Directs" the scene:** You describe a vibe (or pick a preset), and a "Virtual Cinematographer" (Gemini 3 Pro) rewrites your idea into a detailed technical camera prompt.
3.  **It "Shoots":** Finally, it generates high-resolution portraits placing your specific characters into that scene.

## 🚀 How to Use

### 1. The "Who" (Upload)
Upload clear photos of the people you want in the portrait. 
*   *Tip:* Use photos with good lighting where the face is clearly visible.

### 2. The "Identity" (Analyze)
The app will automatically detect faces and write a physical description for each person.
*   **Review this!** If the AI says "brown hair" but your subject has "neon green hair", edit the text manually here for better results.

### 3. The "Where" (Scene & Style)
This is the creative part.
*   **Write a prompt:** "Eating pizza on the moon", "In a cyberpunk noodle bar", etc.
*   **Or use a Preset:** Click buttons like "Movie Set", "Time Travel", or "Cosplay" to let the AI invent a scenario for you.
*   **Variations:** Choose to generate 2, 4, or 8 images at once.

### 4. Generate & Download
Click **Generate**. You can verify the estimated cost of the session in the top bar (📊). Once done, click on any image to view it in high-res, or download everything as a ZIP.

---

## 🔒 Privacy & Security

**This application is 100% Client-Side.**

*   **No Backend Server:** The app runs entirely in your browser.
*   **Direct Connection:** Your photos and API keys are sent directly from your browser to Google's servers. They never pass through any intermediate server owned by me.
*   **API Key Storage:** If you enter your API Key, it is saved in your browser's `localStorage` for convenience. You can clear it at any time using the button in the header.

---

## 🛠️ For Developers: Running Locally

If you want to clone and run this project:

### Prerequisites
*   Node.js (v18+)
*   A [Google Gemini API Key](https://aistudio.google.com/app/apikey) (Paid tier required for Image Generation).

### Installation

1.  **Clone the repo**
    ```bash
    git clone https://github.com/your-username/portrait-obostudio.git
    cd portrait-obostudio
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Run Development Server**
    ```bash
    npm run dev
    ```

4.  **Environment Variables (Optional)**
    You can create a `.env` file to hardcode an API key for personal use (not recommended for public deployment):
    ```env
    API_KEY=your_gemini_api_key_here
    ```

---

## 🧩 Tech Stack

*   **Frontend:** React 19, Vite, TypeScript
*   **Styling:** Tailwind CSS
*   **AI SDK:** Google GenAI SDK (`@google/genai`)
*   **Models Used:**
    *   `gemini-2.5-flash` (Vision/Analysis)
    *   `gemini-3-pro-preview` (Prompt Engineering)
    *   `gemini-3-pro-image-preview` (Image Generation)

---

## ❤️ Credits

Built with passion by [obokaman](https://albert.garcia.gibert.es/).
Powered by **Google Gemini API**.
