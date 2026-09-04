package com.karos.mathclash

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.karos.mathclash.game.MathClashViewModel
import com.karos.mathclash.ui.MathClashApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            val model: MathClashViewModel = viewModel()
            MathClashApp(model)
        }
    }
}
