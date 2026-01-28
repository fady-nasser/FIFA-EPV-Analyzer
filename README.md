# FIFA EPV Analyzer

A sophisticated football analytics dashboard for calculating and visualizing **Expected Possession Value (EPV)** and **Pitch Control**. This tool implements the methodology described in the research paper *"Decomposing the Immeasurable: The Flow of Expected Possession Value"* by Fernández, Bornn, and Cervone (2019).

## 🚀 Features

- **EPV Calculation**: Real-time evaluation of possession value based on player positioning and ball location.
- **Pitch Control Analysis**: Time-to-intercept based model to determine team influence over different areas of the pitch.
- **Action Probabilities**: Analyzes the likelihood and expected value of passes, ball drives, and shots.
- **Defensive Line Detection**: Automatically identifies defensive lines and zones (Z1-Z4) to provide tactical context.
- **Pass Evaluation**: Ranks potential pass options based on success probability and EPV added.
- **Interactive Pitch**: A visual representation of the pitch with heatmaps for EPV and pitch control.

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)

## 📥 Installation

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/fady-nasser/FIFA-EPV-Analyzer.git
    cd FIFA-EPV-Analyzer
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

## 🏃 Usage

To start the development server and view the dashboard in your browser:

```bash
npm run dev
```

Once the server is running, the application will usually be accessible at `http://localhost:5173`.

## 📁 Project Structure

- `src/components/`: React components for the UI (Pitch, EPV Panel, Controls).
- `src/utils/`: Core analytical models:
  - `epvCalculator.js`: Main entry point for frame analysis.
  - `epvModel.js`: Calculations for stock EPV and surface generation.
  - `pitchControl.js`: Physics-based pitch control model.
  - `passEvaluator.js`: Logic for evaluating pass risks and rewards.
  - `ballDriveModel.js`: Evaluation of ball carrier movement.
  - `defensiveLines.js`: Tactical zone and line detection.
  - `dataLoader.js`: Handles tracking and event data parsing.

## 📊 Technical Background

The analyzer uses a decomposed EPV approach:
1.  **Selection Probability**: Likelihood of a player choosing a specific action (pass, drive, shot).
2.  **Outcome Probability**: Chance of the action being successful (e.g., pass completion).
3.  **Expected Value**: The EPV of the resulting state after the action.

## 📄 License

This project is for educational purposes related to sports analytics.
