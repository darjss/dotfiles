# Zoxide 'z' command completion
# Provides completions from zoxide database while keeping standard zoxide behavior

function __z_complete
    set -l tokens (commandline -opc)
    set -l current (commandline -ct)
    
    # Get number of arguments (excluding command name)
    set -l argc (math (count $tokens) - 1)
    
    # For first argument or when we have a partial token
    if test $argc -le 1
        # First try directory completion (like cd)
        set -l dirs (complete -C"nonexistent $current" 2>/dev/null | string match -r '.*/$')
        
        if set -q dirs[1]
            # Show directories
            printf "%s\tDirectory\n" $dirs
        end
        
        # Also show zoxide matches
        if test -n "$current"
            set -l zoxide_matches (zoxide query --list -- $current 2>/dev/null | head -10)
            for match in $zoxide_matches
                # Only show if not already covered by directory completion
                if not contains -- "$match/" $dirs
                    printf "%s\tZoxide\n" $match
                end
            end
        else
            # Show top zoxide entries when no input yet
            set -l zoxide_matches (zoxide query --list 2>/dev/null | head -8)
            for match in $zoxide_matches
                printf "%s\tZoxide\n" $match
            end
        end
    else
        # Multi-word query: use all tokens for zoxide search
        set -l query $tokens[2..-1] $current
        set -l zoxide_matches (zoxide query --list -- $query 2>/dev/null | head -10)
        for match in $zoxide_matches
            printf "%s\tZoxide\n" $match
        end
    end
end

# Disable file completion, use our custom function
complete -c z -f
complete -c z -a '(__z_complete)'
