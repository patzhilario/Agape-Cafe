import { useState } from 'react'
import { IconButton, InputAdornment, TextField } from '@mui/material'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'

export function PasswordField({ slotProps, ...props }) {
  const [isVisible, setIsVisible] = useState(false)

  return (
    <TextField
      {...props}
      type={isVisible ? 'text' : 'password'}
      slotProps={{
        ...slotProps,
        input: {
          ...slotProps?.input,
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                type="button"
                edge="end"
                aria-label={`${isVisible ? 'Hide' : 'Show'} ${props.label || 'password'}`}
                aria-pressed={isVisible}
                disabled={props.disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setIsVisible((current) => !current)}
              >
                {isVisible ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}
